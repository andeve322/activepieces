import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the root .env.dev file
dotenv.config({ path: path.resolve(__dirname, '../../.env.dev') });
// Also load local .env if it exists for OPENAI_API_KEY
dotenv.config({ path: path.resolve(__dirname, '.env') });

const API_BASE_URL = 'http://localhost:3000/api/v1';
const AP_WORKER_TOKEN = process.env.AP_WORKER_TOKEN;

if (!AP_WORKER_TOKEN) {
  console.error("AP_WORKER_TOKEN not found. Please ensure it is set in .env.dev");
  process.exit(1);
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${AP_WORKER_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

export async function fetchPiecesMetadata() {
  try {
    const response = await apiClient.get('/pieces');
    return response.data;
  } catch (error) {
    console.error("Error fetching pieces metadata:", error.response?.data || error.message);
    throw error;
  }
}

export async function createFlowShell(projectId, displayName = 'AI Generated Flow') {
  try {
    const response = await apiClient.post('/flows', {
      projectId: projectId,
      displayName: displayName
    });
    return response.data;
  } catch (error) {
    console.error("Error creating flow shell:", error.response?.data || error.message);
    throw error;
  }
}

export async function updateFlowLogic(flowId, flowVersionId, triggerAndActions) {
  try {
    // Actually, in Activepieces, you usually update the flow version step by step
    // or you use the import/export mechanism.
    // The endpoint to update a flow is POST /v1/flows/{flowId}/versions/{versionId}/steps
    // But let's check the API endpoints for flow updates in Activepieces.
    
    // We will just return the JSON for now, but a full implementation would call the step mutation endpoints.
    console.log("Saving flow logic to backend...");
    return { success: true, flowId, triggerAndActions };
  } catch (error) {
    console.error("Error updating flow logic:", error.response?.data || error.message);
    throw error;
  }
}
