export default {
	async fetch(request, env, ctx): Promise<Response> {
	  // Parse the user's question from the query string, e.g. ?q=What is a mutex?
	  const url = new URL(request.url);
	  const question = url.searchParams.get("q") || "Hello! What can you do?";
  
	  // Call Cloudflare Workers AI (Llama 3.3 8B Instruct)
	  const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
		messages: [
		  { role: "system", content: "You are a helpful assistant for computer science students." },
		  { role: "user", content: question },
		],
	  });	  
  
	  // Return the model’s text as JSON
	  return new Response(JSON.stringify({ question, answer: aiResponse }), {
		headers: { "Content-Type": "application/json" },
	  });
	},
  } satisfies ExportedHandler<Env>;
  