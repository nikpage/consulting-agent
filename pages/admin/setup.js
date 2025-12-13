import { useEffect, useState } from "react";

export default function Setup() {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch("/api/auth/url")
      .then(r => r.json())
      .then(j => setUrl(j.url))
      .catch(e => setErr(String(e)));
  }, []);

  if (err) return <pre>{err}</pre>;
  if (!url) return <p>Loading…</p>;

  return (
    <div style={{fontFamily:"Arial", padding:20}}>
      <h1>Connect Google</h1>
      <p><a href={url} style={{fontSize:18}}>Sign in with Google</a></p>
    </div>
  );
}
