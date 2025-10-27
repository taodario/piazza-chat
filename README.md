# Piazza AI Assistant

An AI-powered Piazza Q&A assistant built on Cloudflare Workers AI and KV Storage.  
Answers questions by retrieving relevant Piazza posts (including replies and follow-ups) as input context.  
Designed for the University of Toronto course CSC369.

## Live Demo
https://cf-ai-piazza-assistant.dariotao01.workers.dev

## Overview
This Worker uses Cloudflare’s Llama 3.1 8B Instruct model to answer course-related questions based on data from Piazza.

When a user asks a question:

1. The Worker retrieves all stored Piazza posts from KV (`piazza_data`).
2. It scores and ranks posts by token overlap with the query (including replies and follow-ups).
3. It builds a compact context block of the top 10 relevant posts.
4. It sends that retrieved Piazza context to `@cf/meta/llama-3.1-8b-instruct-awq`.
5. The model generates an answer strictly from that context and cites relevant post IDs.

## Tech Stack
- Cloudflare Workers (TypeScript)
- Workers AI – `@cf/meta/llama-3.1-8b-instruct-awq`
- Cloudflare KV Storage
- Wrangler 4.42
