/**
 * index.ts
 * Main entry point for the Consulting Sales Agent.
 */

import { SalesAgent, CustomerQuery } from './src/agent/logic';

function main() {
    // Initialize the agent
    const agent = new SalesAgent("SalesWizard-1");

    // Mock incoming customer queries
    const queries: CustomerQuery[] = [
        { text: "What services do you offer?" },
        { text: "I have a budget of $15000", budget: 15000 },
        { text: "Is it expensive?" },
        { text: "I have $500", budget: 500 } // Below threshold
    ];

    console.log("--- Starting Sales Agent Simulation ---\n");

    queries.forEach((q, index) => {
        console.log(`Query #${index + 1}: ${JSON.stringify(q)}`);
        // Basic error handling in case the logic file isn't perfectly synced yet
        try {
            const response = agent.processQuery(q);
            console.log(`Agent: ${response.message}`);
            console.log(`Action: ${response.action} (Confidence: ${response.confidence})`);
        } catch (error) {
            console.error("Error processing query:", error);
        }
        console.log("-".repeat(40));
    });
}

// Execute
main();
