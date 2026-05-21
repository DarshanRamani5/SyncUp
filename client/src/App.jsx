function App() {
  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
              S
            </span>
            SyncUp
          </div>
          <span className="text-sm text-slate-500">React + Tailwind</span>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            Welcome to SyncUp
          </h1>
          <p className="mt-2 text-slate-600">
            This is the starter UI for the chat client. We will build the real
            chat screens next.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-700">Status</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                Setup complete
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-700">Next</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                Build auth screens
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
