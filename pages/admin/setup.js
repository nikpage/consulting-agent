import { useState } from "react";

export default function Setup() {
  const [state, setState] = useState("");
  return (
    <div style={{fontFamily:"Arial",padding:20}}>
      <h2>Connect Google</h2>
      <p>Paste the client ID (state) shown by: <code>node setup-client.js</code></p>
      <input value={state} onChange={e=>setState(e.target.value)} placeholder="state UUID" style={{width:420,padding:8}} />
      <div style={{marginTop:12}}>
        <a href={`/api/auth/url?state=${encodeURIComponent(state)}`} style={{padding:"8px 12px",border:"1px solid #333",borderRadius:6,textDecoration:"none"}}>
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
