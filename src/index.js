export default {
  async fetch(request) {
    return new Response(JSON.stringify({ msg: "Hello from Gemini News Worker!" }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
