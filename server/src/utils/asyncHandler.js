const asyncHandler = (fn) => {
  return (req, res, next) => {
    // If the async function throws an error, .catch(next) automatically 
    // runs next(error) for you behind the scenes!
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

export default asyncHandler