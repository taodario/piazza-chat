# Piazza AI Assistant

An AI-powered Piazza Q&A assistant built on **Cloudflare Workers AI** and **KV Storage**.

Answers questions by retrieving Piazza posts used as input. For Piazza course: CSC369.

## 🚀 Live Demo
https://cf-ai-piazza-assistant.dariotao01.workers.dev

## 🧠 Overview
This worker uses Cloudflare’s Llama 3.1 8B Instruct model to answer questions based on Piazza forum data stored in KV.

When a user asks a question:
1. The worker retrieves all stored Piazza posts from KV (`piazza_data`).
2. It scores and ranks posts by token overlap with the query (including replies and follow-ups).
3. It builds a compact context block and sends it to `@cf/meta/llama-3.1-8b-instruct-awq`.
4. The model answers using only that context and cites Piazza post IDs.

## 🧩 Tech Stack
- **Cloudflare Workers** (TypeScript)
- **Workers AI**
- **Cloudflare KV Storage**
- **Wrangler 4.42**
- Minimal HTML + Vanilla JS frontend

## 🛠️ Development
```bash
# Dev with local preview KV
npx wrangler kv namespace create piazza_data --preview
npx wrangler kv key put piazza_data --binding=piazza_data --path=./piazza_data.json --preview
npx wrangler dev

# Deploy to production
npx wrangler deploy
