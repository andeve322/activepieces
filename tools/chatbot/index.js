import readline from 'readline';
import { initChat, handleUserInput } from './llm.js';
import { createFlowShell, updateFlowLogic } from './api.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log("Initializing Workflow Architect Chatbot...");
  await initChat();
  console.log("\nChatbot initialized. Type 'exit' or 'quit' to stop.");
  console.log("How can I help you build your Activepieces workflow today?\n");

  const askQuestion = () => {
    rl.question('You: ', async (userInput) => {
      if (userInput.trim().toLowerCase() === 'exit' || userInput.trim().toLowerCase() === 'quit') {
        console.log("Goodbye!");
        rl.close();
        return;
      }

      try {
        const { reply, flowJson } = await handleUserInput(userInput);
        console.log(`\nAgent: ${reply}\n`);

        if (flowJson) {
          console.log("✨ Flow JSON generated. Pushing to Activepieces API...");
          // We assume a project ID is available or use a default one if needed.
          // The local instance often requires a projectId. We will just use 'default' or fetch it.
          // For simplicity, we just pass what the API expects or let it fail gracefully.
          // Getting project ID requires an authenticated request to /v1/users/me or /v1/projects.
          
          try {
            // Note: In CE, projects are default. Let's try creating a flow without projectId if it's implicitly handled
            // or we might get an error.
            const flowShell = await createFlowShell('default', flowJson.displayName || 'AI Generated Flow');
            console.log(`Flow created with ID: ${flowShell.id}`);
            
            await updateFlowLogic(flowShell.id, flowShell.version.id, flowJson);
            console.log(`✅ Flow successfully created in Activepieces!`);
          } catch (e) {
            console.log(`❌ Failed to push flow to Activepieces. Check API logs.`);
          }
        }
      } catch (error) {
        console.error("Error communicating with AI:", error.message);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
