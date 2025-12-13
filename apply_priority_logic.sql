-- Function: Calculate Priority Score (Role + Stage + Urgency)
CREATE OR REPLACE FUNCTION update_priority_score(target_thread_id UUID)
RETURNS VOID AS $$
DECLARE
    base_score INTEGER := 0;
    urgency_score INTEGER := 0;
    thread_rec RECORD;
BEGIN
    -- 1. Get Thread Context
    SELECT deal_type, state INTO thread_rec FROM conversation_threads WHERE id = target_thread_id;

    -- 2. Base Scoring
    IF thread_rec.deal_type = 'Seller' THEN base_score := base_score + 3;
    ELSIF thread_rec.deal_type = 'Buyer' THEN base_score := base_score + 2;
    END IF;

    IF thread_rec.state = 'Closing' THEN base_score := base_score + 3;
    ELSIF thread_rec.state = 'Negotiating' THEN base_score := base_score + 2;
    ELSIF thread_rec.state = 'Lead' THEN base_score := base_score + 1;
    END IF;

    -- 3. Urgency Scoring (Deadlines)
    SELECT COALESCE(MAX(CASE 
        WHEN due_date < CURRENT_DATE THEN 4 
        WHEN due_date = CURRENT_DATE THEN 3 
        WHEN due_date = CURRENT_DATE + 1 THEN 2 
        ELSE 0 END), 0) INTO urgency_score
    FROM todos
    WHERE thread_id = target_thread_id AND status != 'completed';

    -- 4. Update
    UPDATE conversation_threads
    SET priority_score = base_score + urgency_score, last_updated = NOW()
    WHERE id = target_thread_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update score when Todos change
CREATE OR REPLACE FUNCTION trigger_update_priority_on_todo() RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_priority_score(NEW.thread_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_priority_after_todo_change
AFTER INSERT OR UPDATE ON todos
FOR EACH ROW EXECUTE FUNCTION trigger_update_priority_on_todo();
