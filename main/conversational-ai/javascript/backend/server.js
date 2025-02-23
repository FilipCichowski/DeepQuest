import path from "path";
import { MongoClient, ObjectId} from 'mongodb';
import { ElevenLabsClient } from "elevenlabs";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

dotenv.config();

app.use(cors());
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "../dist")));

// MongoDB connection URL
const uri = "mongodb+srv://kacperurbanowski05:0aji8Wm0w12CDrju@cluster0.b6yoi.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const dbName = 'myDatabase';
const db = await connectToMongo();

// Connection function
async function connectToMongo() {
  try {
    const client = await MongoClient.connect(uri);
    console.log('Connected successfully to MongoDB');
    return client.db(dbName);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

const ELEVENLABS_API_KEY = 'sk_a8ff9ec0ce1dc380f8aff53b1958d7b849bd596769c0e8af';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

app.use(express.json());

const client = new ElevenLabsClient({
  apiKey: 'sk_643d42f2e85e431fc182c588d2d99cb922436b1b68b16d14'
});

function createInterviewPrompt(title, questions) {
  return `
You are a professional interviewer conducting an interview for ${title}. 
Your role is to ask the following questions in order:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Instructions:
1. Ask one question at a time
2. Listen to the candidate's response
3. Ask relevant follow-up questions if needed
4. Move to the next question when ready
5. Maintain a professional and friendly tone
6. Take notes on key points from responses

Start by introducing yourself and asking the first question.`;
}

// Get all campaigns endpoint
app.get('/campaigns', async (req, res) => {
  try {
    // Fetch all campaigns from MongoDB
    const campaigns = await db.collection('campaigns')
      .find({})
      .sort({ createdAt: -1 }) // Sort by creation date, newest first
      .toArray();

    return res.status(200).json({
      success: true,
      campaigns
    });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch campaigns',
      details: error.message
    });
  }
});

// Campaign creation endpoint
app.post('/createCampaigns', async (req, res) => {
  try {
    console.log("here")

    // Validate request body
    const { title, questions = [] } = req.body;
    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }

    // Create campaign document
    const campaign = {
      title,
      questions,
      createdAt: new Date()
    };

    // Insert campaign into MongoDB
    const campaignResult = await db.collection('campaigns').insertOne(campaign);

    try {
      // Update campaign with agent details
      const interviewPrompt = createInterviewPrompt(campaign.title, campaign.questions);
      const agentResponse = await client.conversationalAi.createAgent({
        name: `${campaign.title || "Title"} Interviewer`,
        conversation_config: {
          agent:{prompt: {
              prompt: interviewPrompt
            }},
          initial_message: "Hello, I'll be conducting your interview today.",
          voice_id: "21m00Tcm4TlvDq8ikWAM",
          language: "en",
          audio_settings: {
            stability: 0.75,
            similarity_boost: 0.75
          }
        }
      });

      console.log(agentResponse);
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentResponse.agent_id}`,
        {
          method: "GET",
          headers: {
            "xi-api-key": process.env.XI_API_KEY,
          },
        }
      );

      console.log(response);
      await db.collection('campaigns').updateOne(
        { _id: campaignResult.insertedId },
        {
          $set: {
            convaiAgentUrl: response.url
          }
        }
      );
      return res.status(201).json({
        success: true,
        url: response.url,
      });

    } catch (convaiError) {
      // Still return success if campaign was created but agent creation failed
      return res.status(201).json({
        success: true,
        campaignId: campaignResult.insertedId,
        campaign,
        warning: 'Campaign created but agent creation failed',
        error: convaiError.message
      });
    }

  } catch (error) {
    console.error('Campaign creation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create campaign',
      details: error.message
    });
  }
});

app.get("/api/signed-url", async (req, res) => {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${process.env.AGENT_ID}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": process.env.XI_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get signed URL");
    }

    const data = await response.json();
    res.json({ signedUrl: data.signed_url });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get signed URL" });
  }
});

//API route for getting Agent ID, used for public agents
app.get("/api/getAgentId", (req, res) => {
  const agentId = process.env.AGENT_ID;
  res.json({
    agentId: `${agentId}`,
  });
});

// Serve index.html for all other routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

app.get("/campaign", (req, res) => {
  res.sendFile(path.join(__dirname, "../src/campaign.html"));
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
});