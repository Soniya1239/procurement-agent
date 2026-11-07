import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY or LLM_API_KEY not found in .env');
  process.exit(1);
}

async function listModels() {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    
    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      process.exit(1);
    }
    
    const data = await response.json();
    
    if (!data.models) {
      console.error('No models found in response');
      process.exit(1);
    }
    
    console.log('Available models that support generateContent:');
    data.models.forEach(model => {
      if (model.supportedGenerationMethods?.includes('generateContent')) {
        console.log(`  - ${model.name}`);
      }
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

listModels();
