import { useState, useEffect } from 'react'
import { getAuthUrl } from '../../lib/google-auth'

export default function AdminSetup() {
  const [password, setPassword] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [clients, setClients] = useState([])
  const [newClient, setNewClient] = useState({ name: '', email: '' })
  const [selectedClient, setSelectedClient] = useState(null)
  const [settings, setSettings] = useState({
    workStartHour: 9,
    workEndHour: 17,
    doNowStart: 9,
    doNowEnd: 10,
    noMeetingBefore: 9,
    defaultLocation: ''
  })

  const checkAuth = () => {
    if (password === process.env.NEXT_PUBLIC_ADMIN_PASSWORD) {
      setAuthenticated(true)
      loadClients()
    } else {
      alert('Wrong password')
    }
  }

  const loadClients = async () => {
    const res = await fetch('/api/admin/clients')
    const data = await res.json()
    setClients(data.clients || [])
  }

  const createClient = async () => {
    const res = await fetch('/api/admin/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newClient)
    })
    const data = await res.json()
    setClients([...clients, data.client])
    setNewClient({ name: '', email: '' })
  }

  const generateOAuthLink = (clientId) => {
    const authUrl = getAuthUrl()
    window.open(`${authUrl}&state=${clientId}`, '_blank')
  }

  const saveSettings = async () => {
    await fetch(`/api/admin/clients/${selectedClient}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    })
    alert('Settings saved')
  }

  if (!authenticated) {
    return (
      <div style={{ padding: '20px' }}>
        <h1>Admin Setup</h1>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button onClick={checkAuth}>Login</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1>Sales Assistant Setup</h1>
      
      <section>
        <h2>Create Client</h2>
        <input
          placeholder="Client name"
          value={newClient.name}
          onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
        />
        <input
          placeholder="Email"
          value={newClient.email}
          onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
        />
        <button onClick={createClient}>Create</button>
      </section>

      <section>
        <h2>Clients</h2>
        {clients.map(client => (
          <div key={client.id}>
            <strong>{client.name}</strong> ({client.email})
            <button onClick={() => generateOAuthLink(client.id)}>Connect Google</button>
            <button onClick={() => setSelectedClient(client.id)}>Configure</button>
          </div>
        ))}
      </section>

      {selectedClient && (
        <section>
          <h2>Client Settings</h2>
          <div>
            <label>Work Start Hour: </label>
            <input
              type="number"
              value={settings.workStartHour}
              onChange={(e) => setSettings({ ...settings, workStartHour: parseInt(e.target.value) })}
            />
          </div>
          <div>
            <label>Work End Hour: </label>
            <input
              type="number"
              value={settings.workEndHour}
              onChange={(e) => setSettings({ ...settings, workEndHour: parseInt(e.target.value) })}
            />
          </div>
          <div>
            <label>Do-Now Start: </label>
            <input
              type="number"
              value={settings.doNowStart}
              onChange={(e) => setSettings({ ...settings, doNowStart: parseInt(e.target.value) })}
            />
          </div>
          <div>
            <label>Do-Now End: </label>
            <input
              type="number"
              value={settings.doNowEnd}
              onChange={(e) => setSettings({ ...settings, doNowEnd: parseInt(e.target.value) })}
            />
          </div>
          <div>
            <label>No Meetings Before: </label>
            <input
              type="number"
              value={settings.noMeetingBefore}
              onChange={(e) => setSettings({ ...settings, noMeetingBefore: parseInt(e.target.value) })}
            />
          </div>
          <div>
            <label>Default Location: </label>
            <input
              value={settings.defaultLocation}
              onChange={(e) => setSettings({ ...settings, defaultLocation: e.target.value })}
            />
          </div>
          <button onClick={saveSettings}>Save Settings</button>
        </section>
      )}
    </div>
  )
}
