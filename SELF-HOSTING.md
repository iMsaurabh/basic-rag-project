# Self-Hosting Guide

## Prerequisites
- Docker Desktop installed (docker.com)
- Groq API key (console.groq.com) 
- OpenWeatherMap API key (openweathermap.org)

## Quick Start

### 1. Clone the repository
git clone https://github.com/yourusername/your-repo
cd your-repo

### 2. Configure environment
cp .env.example .env
# Open .env and fill in your API keys

### 3. Add your knowledge base
# Replace document.txt with your own content
# This is what the AI will answer questions about

### 4. Start the application
docker compose up -d

### 5. Verify it's running
curl http://localhost:3000/health

## Usage

### Send a message
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "user1", "message": "your question here"}'

### List active sessions
curl http://localhost:3000/sessions

### Clear a session
curl -X DELETE http://localhost:3000/chat/user1

## Configuration
All settings can be customized in your .env file:

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| MAX_ITERATIONS | 10 | Max agent loop iterations |
| MAX_HISTORY | 10 | Max messages kept in context |
| MAX_MESSAGE_LENGTH | 1000 | Max characters per message |
| RATE_LIMIT_MAX | 10 | Max requests per minute |
| SESSION_TTL | 86400 | Session expiry in seconds |

## Updating Your Knowledge Base
When you update document.txt:

1. Restart with rebuild
   docker compose up --build -d

2. Clear existing sessions (they reference old document)
   curl -X DELETE http://localhost:3000/chat/user1

## Troubleshooting

| Problem | Solution |
|---------|---------|
| Port 3000 already in use | Change PORT in .env |
| Redis connection error | Run docker compose down then up again |
| Agent not finding info | Check document.txt has relevant content |
| Groq API errors | Verify GROQ_API_KEY is correct |

## Stopping the Application
docker compose down

## Viewing Logs
docker compose logs -f api