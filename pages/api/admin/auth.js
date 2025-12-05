export default function handler(req, res) {
  if (req.method === 'POST') {
    const { password } = req.body
    console.log('Received:', password)
    console.log('Expected:', process.env.ADMIN_PASSWORD)
    if (password === process.env.ADMIN_PASSWORD) {
      res.status(200).json({ success: true })
    } else {
      res.status(401).json({ success: false })
    }
  }
}
