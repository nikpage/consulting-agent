import { createClient } from '@supabase/supabase-js';
import { runAgentForClient } from '../agent/agentRunner';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY!
);

async function runCommand(clientId?: string) {
  if (clientId) {
    // Run for single client
    const result = await runAgentForClient(clientId);
    if (result.errors.length > 0) {
      console.log(`✗ Client ${clientId}: ${result.processedMessages} messages processed, ${result.errors.length} errors`);
      result.errors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log(`✓ Client ${clientId}: ${result.processedMessages} messages processed`);
    }
  } else {
    // Run for all clients
    const { data: clients } = await supabase
      .from('users')
      .select('id, settings')
      .not('google_oauth_tokens', 'is', null);

    if (!clients || clients.length === 0) {
      console.log('No clients found');
      return;
    }

    // Filter out paused clients
    const activeClients = clients.filter(c => !c.settings?.agent_paused);

    if (activeClients.length === 0) {
      console.log('No active clients found (all paused)');
      return;
    }

    console.log(`Running agent for ${activeClients.length} clients...`);
    for (const client of activeClients) {
      const result = await runAgentForClient(client.id);
      if (result.errors.length > 0) {
        console.log(`✗ Client ${client.id}: ${result.processedMessages} messages processed, ${result.errors.length} errors`);
      } else {
        console.log(`✓ Client ${client.id}: ${result.processedMessages} messages processed`);
      }
    }
  }
}

async function pauseCommand(clientId: string) {
  const { data: client } = await supabase
    .from('users')
    .select('settings')
    .eq('id', clientId)
    .single();

  if (!client) {
    console.log(`✗ Client ${clientId} not found`);
    return;
  }

  const settings = client.settings || {};
  settings.agent_paused = true;

  await supabase
    .from('users')
    .update({ settings })
    .eq('id', clientId);

  console.log(`✓ Client ${clientId}: agent paused`);
}

async function healthCommand(clientId: string) {
  const { data: client } = await supabase
    .from('users')
    .select('*')
    .eq('id', clientId)
    .single();

  if (!client) {
    console.log(`✗ Client ${clientId} not found`);
    return;
  }

  console.log(`Client ${clientId}:`);
  console.log(`  Email: ${client.email || 'N/A'}`);
  console.log(`  Tokens: ${client.google_oauth_tokens ? '✓ Present' : '✗ Missing'}`);
  console.log(`  Agent paused: ${client.settings?.agent_paused ? 'Yes' : 'No'}`);
  console.log(`  Calendar webhook expires: ${client.settings?.calendar_webhook_expires ? new Date(parseInt(client.settings.calendar_webhook_expires)).toISOString() : 'N/A'}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  agent run --client <id>');
    console.log('  agent run --all');
    console.log('  agent pause --client <id>');
    console.log('  agent health --client <id>');
    process.exit(1);
  }

  const command = args[0];

  try {
    if (command === 'run') {
      if (args[1] === '--client' && args[2]) {
        await runCommand(args[2]);
      } else if (args[1] === '--all') {
        await runCommand();
      } else {
        console.log('Invalid run command. Use: agent run --client <id> or agent run --all');
        process.exit(1);
      }
    } else if (command === 'pause') {
      if (args[1] === '--client' && args[2]) {
        await pauseCommand(args[2]);
      } else {
        console.log('Invalid pause command. Use: agent pause --client <id>');
        process.exit(1);
      }
    } else if (command === 'health') {
      if (args[1] === '--client' && args[2]) {
        await healthCommand(args[2]);
      } else {
        console.log('Invalid health command. Use: agent health --client <id>');
        process.exit(1);
      }
    } else {
      console.log(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.log(`✗ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
