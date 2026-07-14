import { Kafka } from 'kafkajs'
import fs from 'fs'
import path from 'path'
import prisma from '../lib/prisma.js'

/**
 * Kafka Configuration — Aiven
 *
 * Data flow:
 *   Socket.IO handler → produceMessage() → Kafka "MESSAGES" topic
 *                                                ↓
 *   startConsumer() ← reads from topic ← Kafka consumer group
 *                                                ↓
 *   Prisma $transaction → PostgreSQL (Message + Conversation.lastMessageAt)
 *
 * Auth: SASL/PLAIN over TLS with ca.pem certificate (Aiven standard)
 *
 * Env vars required:
 *   AIVEN_KAFKA_HOST     — broker endpoint (e.g., kafka-xxx.aivencloud.com:12345)
 *   AIVEN_KAFKA_USERNAME — Aiven service username
 *   AIVEN_KAFKA_PASSWORD — Aiven service password
 *
 * File required:
 *   ca.pem — Aiven CA certificate, placed in server root directory
 *            Download from: Aiven Console → Your Kafka service → Overview → CA Certificate
 */

const KAFKA_HOST = process.env.AIVEN_KAFKA_HOST
const KAFKA_USERNAME = process.env.AIVEN_KAFKA_USERNAME
const KAFKA_PASSWORD = process.env.AIVEN_KAFKA_PASSWORD

const TOPIC = 'MESSAGES'
const CONSUMER_GROUP = 'syncup-message-consumer'

/**
 * Check if Kafka is configured (broker host present, ca.pem exists, and either client certs or SASL credentials exist)
 */
const isKafkaConfigured = () => {
  if (!KAFKA_HOST) {
    return false
  }

  // Check if ca.pem exists in the server root
  const caPath = path.resolve('./ca.pem')
  if (!fs.existsSync(caPath)) {
    console.warn('⚠️  ca.pem not found at', caPath, '— Kafka disabled')
    return false
  }

  // Check if client certificates are present
  const keyPath = path.resolve('./service.key')
  const certPath = path.resolve('./service.cert')
  const hasClientCerts = fs.existsSync(keyPath) && fs.existsSync(certPath)

  // Check if SASL credentials are present
  const hasSasl = !!(KAFKA_USERNAME && KAFKA_PASSWORD)

  if (!hasClientCerts && !hasSasl) {
    console.warn('⚠️  Neither client certificates (service.key + service.cert) nor SASL credentials found — Kafka disabled')
    return false
  }

  return true
}

/**
 * Create the KafkaJS client instance.
 * Supports Aiven's Client Certificate (mTLS) mode or SASL/PLAIN over TLS.
 */
let kafka = null

const getKafkaClient = () => {
  if (kafka) return kafka

  if (!isKafkaConfigured()) return null

  const caPath = path.resolve('./ca.pem')
  const keyPath = path.resolve('./service.key')
  const certPath = path.resolve('./service.cert')

  const hasClientCerts = fs.existsSync(keyPath) && fs.existsSync(certPath)

  const kafkaConfig = {
    clientId: 'syncup-server',
    brokers: [KAFKA_HOST],
    // Connection timeout and retry settings
    connectionTimeout: 10000,
    retry: {
      initialRetryTime: 300,
      retries: 5
    }
  }

  if (hasClientCerts) {
    console.log('📨 Configuring Kafka using Client Certificate (mTLS) authentication')
    kafkaConfig.ssl = {
      rejectUnauthorized: true,
      ca: [fs.readFileSync(caPath, 'utf-8')],
      key: fs.readFileSync(keyPath, 'utf-8'),
      cert: fs.readFileSync(certPath, 'utf-8')
    }
  } else {
    console.log('📨 Configuring Kafka using SASL/PLAIN authentication')
    kafkaConfig.ssl = {
      rejectUnauthorized: true,
      ca: [fs.readFileSync(caPath, 'utf-8')]
    }
    kafkaConfig.sasl = {
      username: KAFKA_USERNAME,
      password: KAFKA_PASSWORD,
      mechanism: 'plain'
    }
  }

  kafka = new Kafka(kafkaConfig)
  return kafka
}

// ============================================================
// PRODUCER — publishes messages to the MESSAGES topic
// ============================================================

let producer = null

/**
 * Initialize the Kafka producer.
 * Called once during server startup.
 * No-op if Kafka is not configured.
 */
export const initProducer = async () => {
  const client = getKafkaClient()
  if (!client) {
    console.log('📨 Kafka not configured — messages will be saved synchronously')
    return null
  }

  try {
    producer = client.producer()
    await producer.connect()
    console.log('📨 Kafka producer connected')
    return producer
  } catch (err) {
    console.error('📨 Kafka producer connection failed:', err.message)
    producer = null
    return null
  }
}

/**
 * Get the current producer instance (may be null if Kafka not configured)
 */
export const getProducer = () => producer

/**
 * Publish a message to the Kafka MESSAGES topic.
 *
 * @param {Object} messageData - The message payload
 * @param {string} messageData.body - Message text
 * @param {string} messageData.conversationId - Target conversation
 * @param {string} messageData.userId - Sender's user ID
 * @param {string} messageData.createdAt - ISO timestamp
 *
 * @returns {boolean} true if published, false if fallback needed
 */
export const produceMessage = async (messageData) => {
  if (!producer) return false

  try {
    await producer.send({
      topic: TOPIC,
      messages: [
        {
          // Use conversationId as the partition key
          // → all messages for the same conversation go to the same partition
          // → guarantees ordering within a conversation
          key: messageData.conversationId,
          value: JSON.stringify(messageData)
        }
      ]
    })
    return true
  } catch (err) {
    console.error('📨 Kafka produce error:', err.message)
    return false
  }
}

// ============================================================
// CONSUMER — reads from MESSAGES topic and persists to PostgreSQL
// ============================================================

let consumer = null

/**
 * Start the Kafka consumer.
 * Subscribes to the MESSAGES topic and processes each message:
 *   1. Parse the JSON payload
 *   2. Prisma $transaction: create Message + update Conversation.lastMessageAt
 *   3. Commit offset (at-least-once delivery)
 *
 * Called once during server startup.
 * No-op if Kafka is not configured.
 */
export const startConsumer = async () => {
  const client = getKafkaClient()
  if (!client) return null

  try {
    consumer = client.consumer({ groupId: CONSUMER_GROUP })
    await consumer.connect()
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false })

    console.log(`📨 Kafka consumer listening on topic: ${TOPIC}`)

    await consumer.run({
      // Don't auto-commit — we commit only after successful DB write
      autoCommit: false,

      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        try {
          const data = JSON.parse(message.value.toString())

          const { id, body, image, public_id, conversationId, userId, createdAt } = data

          // Persist to PostgreSQL via Prisma $transaction
          // Same logic that was previously in the socket handler
          await prisma.$transaction([
            prisma.message.create({
              data: {
                id,
                body: body || null,
                image: image || null,
                public_id: public_id || null,
                conversationId,
                userId,
                // Use the original timestamp from when the message was sent
                createdAt: new Date(createdAt)
              }
            }),
            prisma.conversation.update({
              where: { id: conversationId },
              data: { lastMessageAt: new Date(createdAt) }
            })
          ])

          // Manually commit offset after successful DB write
          // This ensures at-least-once delivery:
          // If the consumer crashes before committing, the message will be re-processed
          await consumer.commitOffsets([
            {
              topic,
              partition,
              offset: (BigInt(message.offset) + 1n).toString()
            }
          ])

          // Send heartbeat to keep the consumer alive during long processing
          await heartbeat()

        } catch (err) {
          // Log but don't crash — the message will be retried on next consumer restart
          // (since we didn't commit the offset)
          console.error('📨 Kafka consumer processing error:', err.message)
        }
      }
    })

    return consumer
  } catch (err) {
    console.error('📨 Kafka consumer failed to start:', err.message)
    consumer = null
    return null
  }
}

// ============================================================
// SHUTDOWN — graceful cleanup
// ============================================================

/**
 * Gracefully disconnect producer and consumer.
 * Called on SIGINT/SIGTERM.
 */
export const shutdownKafka = async () => {
  try {
    if (producer) {
      await producer.disconnect()
      console.log('📨 Kafka producer disconnected')
    }
    if (consumer) {
      await consumer.disconnect()
      console.log('📨 Kafka consumer disconnected')
    }
  } catch (err) {
    console.error('📨 Kafka shutdown error:', err.message)
  }
}

export default { initProducer, getProducer, produceMessage, startConsumer, shutdownKafka }
