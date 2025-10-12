// src/index.ts

interface PiazzaPost {
	id: string;
	subject: string;
	content: string;
	created: string;
	tags: string[];
	type: string;
	answers: {
		instructor?: string[];
		student?: string[];
		followups?: { content?: string; comments?: string[] }[];
	};
}

interface Env {
	piazza_data: KVNamespace; // KV binding
	AI: Ai;                   // Workers AI binding
  }
  

// --- Helpers ---

function stripHtml(html: string = ""): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|md)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function tokenize(s: string): string[] {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, " ")
		.split(/\s+/)
		.filter(Boolean);
}

// --- Scoring (now reply-aware) ---

function score(post: PiazzaPost, q: string): number {
	// Combine subject + body
	let fullText = `${post.subject || ""} ${stripHtml(post.content || "")}`;

	// Add instructor replies (string or object)
	const instructorReplies = (post.answers?.instructor || [])
		.map((x: any) => (typeof x === "string" ? x : x.content || ""))
		.map(stripHtml)
		.join(" ");

	// Add student replies
	const studentReplies = (post.answers?.student || [])
		.map((x: any) => (typeof x === "string" ? x : x.content || ""))
		.map(stripHtml)
		.join(" ");

	// Add followup questions + comments
	const followups = (post.answers?.followups || [])
		.map((f: any) => {
			const content = stripHtml(f.content || "");
			const comments = (f.comments || [])
				.map((c: any) => stripHtml(typeof c === "string" ? c : c.content || ""))
				.join(" ");
			return `${content} ${comments}`;
		})
		.join(" ");

	fullText += " " + instructorReplies + " " + studentReplies + " " + followups;

	// Tokenize
	const postTokens = new Set(tokenize(fullText));
	const queryTokens = tokenize(q);

	let matches = 0;
	for (const t of queryTokens) {
		if (postTokens.has(t)) matches++;
	}

	// Small bonuses for direct matches
	if ((post.subject || "").toLowerCase().includes(q.toLowerCase())) matches += 2;
	if ((post.tags || []).some(tag => q.toLowerCase().includes(tag.toLowerCase()))) matches += 1;

	return matches;
}


// --- Pick top-k posts ---

function pickTop(posts: PiazzaPost[], q: string, k = 10): PiazzaPost[] {
	return posts
		.map((p) => ({ p, s: score(p, q) }))
		.filter((x) => x.s > 0)
		.sort((a, b) => b.s - a.s)
		.slice(0, k)
		.map((x) => x.p);
}

// --- Fetch all posts from KV ---

async function getAll(env: Env): Promise<PiazzaPost[]> {
	const raw = await env.piazza_data.get("piazza_data");
	if (!raw) throw new Error("No data found in KV (key: piazza_data)");
	return JSON.parse(raw) as PiazzaPost[];
}

// --- Main Worker ---

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, "");

		try {
			// --- HTML FRONT-END PAGE ---
			if (path === "" || path === "/") {
				return new Response(frontendHtml(), {
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}

			// --- /ask endpoint ---
			if (path === "/ask") {
				const q = url.searchParams.get("q") || "";
				if (!q)
					return json({ error: "Pass your question as /ask?q=..." }, 400);

				const data = await getAll(env);
				const top = pickTop(data, q, 10);

				if (top.length === 0)
					return json({
						query: q,
						answer: "I couldn't find anything relevant in your Piazza data.",
						used_posts: [],
					});

					const contextBlocks = top.map((p, i) => {
						const body = stripHtml(p.content).slice(0, 1200);
					  
						const instructor = (p.answers?.instructor || [])
						  .map((x: any) => stripHtml(typeof x === "string" ? x : x.content || ""))
						  .filter(Boolean)
						  .join("\n- ");
					  
						const student = (p.answers?.student || [])
						  .map((x: any) => stripHtml(typeof x === "string" ? x : x.content || ""))
						  .filter(Boolean)
						  .join("\n- ");
					  
						const followups = (p.answers?.followups || [])
						  .map((f: any, idx: number) => {
							const fcontent = stripHtml(f.content || "");
							const fcomments = (f.comments || [])
							  .map((c: any) => stripHtml(typeof c === "string" ? c : c.content || ""))
							  .filter(Boolean)
							  .map((c: string) => `    ↳ ${c}`)
							  .join("\n");
							return `Follow-up #${idx + 1}: ${fcontent}${fcomments ? `\n${fcomments}` : ""}`;
						  })
						  .join("\n");
					  
						let extras = "";
						if (instructor) extras += `\nInstructor replies:\n- ${instructor}`;
						if (student) extras += `\nStudent replies:\n- ${student}`;
						if (followups) extras += `\nFollow-ups:\n${followups}`;
					  
						return `# ${i + 1}. ${p.subject} (id: ${p.id}, date: ${p.created})
					  Tags: ${p.tags?.join(", ") || "-"}
					  Body:
					  ${body}${extras ? `\n${extras}` : ""}`;
					  });
					  

				const systemPrompt = [
					"You are a helpful TA Assistant for CSC209/CSC369/CSC373.",
					"Answer the student's question strictly from the provided Piazza context.",
					"If the context is insufficient, say so briefly and suggest what to search next.",
					"Prefer concise, actionable answers with bullet points and cite post ids like (see id: XXXXX).",
				].join(" ");

				const model = "@cf/meta/llama-3.1-8b-instruct-awq";

				const messages = [
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content:
							`Question: ${q}\n\n---\nPiazza Context (${top.length} posts):\n` +
							contextBlocks.join("\n\n---\n") +
							`\n---\nOnly use the information above.`,
					},
				];

				const result = await env.AI.run(model, { messages });

				return json({
					query: q,
					answer: result.response.trim(),
					used_posts: top.map((p) => ({
						id: p.id,
						subject: p.subject,
						content: stripHtml(p.content).slice(0, 400),
						tags: p.tags,
						created: p.created,
					})),
				});
			}

			return json({ error: "Not found" }, 404);
		} catch (err: any) {
			return json({ error: err.message || String(err) }, 500);
		}
	},
} satisfies ExportedHandler<Env>;

// --- Utility: JSON helper ---
function json(data: any, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
	});
}

// --- HTML Frontend ---
function frontendHtml(): string {
	return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="UTF-8" />
  <title>Piazza AI Assistant</title>
  <style>
	body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
	h1 { color: #333; }
	form { margin-bottom: 1rem; }
	input[type="text"] {
	  width: 70%;
	  padding: 0.6rem;
	  border-radius: 6px;
	  border: 1px solid #ccc;
	}
	button {
	  padding: 0.6rem 1rem;
	  background: #0070f3;
	  color: white;
	  border: none;
	  border-radius: 6px;
	  cursor: pointer;
	}
	button:hover { background: #0059c1; }
	.samples { margin: 0.5rem 0 1.25rem; }
	.samples h3 { font-size: 0.95rem; color: #444; margin: 0 0 0.4rem; }
	.samples button.sample {
	  margin: 0.2rem 0.2rem 0.2rem 0;
	  padding: 0.4rem 0.7rem;
	  font-size: 0.9rem;
	  background: #f5f5f5;
	  color: #333;
	  border: 1px solid #ddd;
	  border-radius: 6px;
	  cursor: pointer;
	}
	.samples button.sample:hover { background: #eee; }
	pre {
	  background: #f7f7f7;
	  padding: 1rem;
	  border-radius: 8px;
	  white-space: pre-wrap;
	}
	details {
	  margin-top: 1rem;
	  background: #fafafa;
	  padding: 0.6rem 1rem;
	  border-radius: 6px;
	}
	summary { cursor: pointer; font-weight: 600; color: #333; }
	.post {
	  margin-top: 0.5rem;
	  padding: 0.5rem;
	  border-left: 3px solid #0070f3;
	  background: #fff;
	}
	.tags { color: #666; font-size: 0.9em; }
  </style>
  </head>
  <body>
	<h1>Piazza AI Assistant</h1>
  
	<form id="ask-form">
	  <input type="text" id="q" name="q" placeholder="Ask about thread_wait..." required />
	  <button type="submit">Ask</button>
	</form>
  
	<div class="samples">
	  <h3>Try asking:</h3>
	  <button class="sample">Was Midterm 1 curved?</button>
	  <button class="sample">Tell me about Task 2</button>
	  <button class="sample">Is survey 2 released?</button>
	</div>
  
	<div id="output"></div>
  
	<script>
	  const form = document.getElementById('ask-form');
	  const out = document.getElementById('output');
	  const input = document.getElementById('q');
  
	  form.addEventListener('submit', async (e) => {
		e.preventDefault();
		runQuery(input.value);
	  });
  
	  document.querySelectorAll('.sample').forEach(btn => {
		btn.addEventListener('click', () => {
		  const q = btn.textContent;
		  input.value = q;
		  runQuery(q);
		});
	  });
  
	  async function runQuery(q) {
		out.innerHTML = '<p><em>Thinking...</em></p>';
		const res = await fetch('/ask?q=' + encodeURIComponent(q));
		const data = await res.json();
  
		if (data.error) {
		  out.innerHTML = '<p style="color:red">' + data.error + '</p>';
		  return;
		}
  
		let html = '<h3>Answer:</h3><pre>' + data.answer + '</pre>';
  
		if (data.used_posts && data.used_posts.length) {
		  html += '<details open><summary>Referenced Piazza Posts (' + data.used_posts.length + ')</summary>';
		  for (const p of data.used_posts) {
			html += '<div class="post">';
			html += '<strong>' + p.subject + '</strong><br>';
			html += '<div class="tags">' + (p.tags?.join(', ') || '-') + ' | ' + new Date(p.created).toLocaleString() + '</div>';
			html += '<pre>' + p.content + '</pre>';
			html += '<em>ID:</em> ' + p.id;
			html += '</div>';
		  }
		  html += '</details>';
		}
  
		out.innerHTML = html;
	  }
	</script>
  </body>
  </html>
	`;
  }
  