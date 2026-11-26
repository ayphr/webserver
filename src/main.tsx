import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './lib/push'
import { migrateSessionAuthToPersistent } from './lib/accounts'
import { queryClient, queryPersister } from './lib/query'
import { shouldPersistQuery } from './lib/query/persist'

migrateSessionAuthToPersistent()

// Registering the worker never prompts for notification permission.
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister, dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery } }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
