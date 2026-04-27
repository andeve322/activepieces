import { fetchPiecesMetadata } from './api.js';
import axios from 'axios';

export async function getSimplifiedMetadata() {
  const pieces = await fetchPiecesMetadata();
  
  // To save LLM tokens, we simplify the output to only essential piece info
  return pieces.map(piece => {
    
    // We fetch detailed actions/triggers if they exist, or just piece level info
    // For the list endpoint, actions and triggers are numbers, but we will mock or just use the summary
    // Since GET /v1/pieces returns a summary, we would need to GET /v1/pieces/{name} to get actual actions/props.
    // For this prototype, we'll return the summary and tell the LLM these are available pieces.
    // In a full implementation, you would fetch the full piece schema for the specific piece the user selects.
    
    return {
      name: piece.name,
      displayName: piece.displayName,
      description: piece.description,
      categories: piece.categories,
      authRequired: piece.auth && piece.auth.length > 0 ? true : false,
      actionsCount: piece.actions,
      triggersCount: piece.triggers
    };
  });
}

// Function to get full details of a specific piece
export async function getPieceDetails(pieceName) {
    const API_BASE_URL = 'http://localhost:3000/api/v1';
    const AP_WORKER_TOKEN = process.env.AP_WORKER_TOKEN;
    const apiClient = axios.create({
      baseURL: API_BASE_URL,
      headers: { 'Authorization': `Bearer ${AP_WORKER_TOKEN}` }
    });

    try {
        // Activepieces API GET /v1/pieces/{name}
        const response = await apiClient.get(`/pieces/${encodeURIComponent(pieceName)}`);
        const piece = response.data;
        
        // Simplify actions and triggers
        const actions = Object.keys(piece.actions).map(actionName => {
            const action = piece.actions[actionName];
            return {
                name: action.name,
                displayName: action.displayName,
                description: action.description,
                properties: Object.keys(action.props).map(propName => {
                    const prop = action.props[propName];
                    return {
                        name: propName,
                        type: prop.type,
                        required: prop.required,
                        displayName: prop.displayName
                    }
                })
            }
        });

        const triggers = Object.keys(piece.triggers).map(triggerName => {
            const trigger = piece.triggers[triggerName];
            return {
                name: trigger.name,
                displayName: trigger.displayName,
                description: trigger.description,
                properties: Object.keys(trigger.props).map(propName => {
                    const prop = trigger.props[propName];
                    return {
                        name: propName,
                        type: prop.type,
                        required: prop.required,
                        displayName: prop.displayName
                    }
                })
            }
        });

        return {
            name: piece.name,
            displayName: piece.displayName,
            actions: actions,
            triggers: triggers
        }
    } catch (error) {
        console.error(`Error fetching details for ${pieceName}:`, error.message);
        return null;
    }
}
