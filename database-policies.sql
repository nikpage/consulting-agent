-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE cps ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cp_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

-- Users: can only see their own record
CREATE POLICY "Users can view own record" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own record" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Channels: user_id based
CREATE POLICY "Users can view own channels" ON channels
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own channels" ON channels
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- CPs: user_id based
CREATE POLICY "Users can view own cps" ON cps
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cps" ON cps
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cps" ON cps
  FOR UPDATE USING (auth.uid() = user_id);

-- Messages: user_id based
CREATE POLICY "Users can view own messages" ON messages
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages" ON messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Message embeddings: via messages table
CREATE POLICY "Users can view own embeddings" ON message_embeddings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM messages
      WHERE messages.id = message_embeddings.message_id
      AND messages.user_id = auth.uid()
    )
  );

-- CP States: via cps table
CREATE POLICY "Users can view own cp_states" ON cp_states
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cps
      WHERE cps.id = cp_states.cp_id
      AND cps.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own cp_states" ON cp_states
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM cps
      WHERE cps.id = cp_states.cp_id
      AND cps.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own cp_states" ON cp_states
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM cps
      WHERE cps.id = cp_states.cp_id
      AND cps.user_id = auth.uid()
    )
  );

-- Events: user_id based
CREATE POLICY "Users can view own events" ON events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own events" ON events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own events" ON events
  FOR UPDATE USING (auth.uid() = user_id);

-- Todos: user_id based
CREATE POLICY "Users can view own todos" ON todos
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own todos" ON todos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own todos" ON todos
  FOR UPDATE USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_messages_user_id ON messages(user_id);
CREATE INDEX idx_messages_cp_id ON messages(cp_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_cps_user_id ON cps(user_id);
CREATE INDEX idx_events_user_id ON events(user_id);
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_todos_user_id ON todos(user_id);
CREATE INDEX idx_todos_due_date ON todos(due_date);
