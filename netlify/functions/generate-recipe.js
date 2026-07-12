// netlify/functions/generate-recipe.js
//
// This function runs on Netlify's servers, not in the browser. It keeps your
// Anthropic API key private (stored as an environment variable) and forwards
// recipe requests to the Anthropic API on the app's behalf.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const query = (payload.query || "").toString().trim();
  const mode = payload.mode || "either";
  const twist = !!payload.twist;

  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing 'query'" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "The server isn't configured with an API key yet. Add ANTHROPIC_API_KEY in Netlify site settings, under Environment variables, then redeploy.",
      }),
    };
  }

  const modeInstruction =
    mode === "original"
      ? "You must invent a brand-new ORIGINAL recipe (not a well-known existing dish). Set type to 'original'."
      : mode === "classic"
      ? "You must draw on a real, well-known existing recipe/dish that matches the request as closely as possible. Set type to 'classic'."
      : "Decide whichever fits best: either invent an original recipe, or draw on a real well-known dish. Set type accordingly.";

  const twistInstruction = twist
    ? "Also include a 'caribbeanTwist' field: 1-2 sentences suggesting a Caribbean/Belizean-inspired ingredient swap or addition (e.g. coconut milk, scotch bonnet pepper, plantain, cassava, culantro, pimento) that would give this dish an island flavor, even if the base dish is not Caribbean."
    : "Do not include a 'caribbeanTwist' field.";

  const systemPrompt = `You are a recipe-generating assistant for "Dee's Recipe Finder", a Caribbean-inspired cooking app. Respond with ONLY a raw JSON object, no markdown fences, no preamble, no commentary. The JSON object must have exactly this shape:
{
  "title": string,
  "type": "original" | "classic",
  "description": string (1-2 sentences, appetizing, plain language),
  "caribbeanTwist": string (optional, only if requested),
  "servings": number (integer, typically 2-6),
  "prepTime": string (e.g. "15 min"),
  "cookTime": string (e.g. "25 min"),
  "ingredients": [ { "amount": number, "unit": string or null, "name": string } ],
  "steps": [ string, string, ... ]
}
Rules: ${modeInstruction} ${twistInstruction}
Keep ingredients between 6 and 12 items. Keep steps between 4 and 8 items, each step a clear, complete sentence. Use realistic amounts for the given servings. Units should be simple strings like "cup", "tbsp", "tsp", "g", "oz", "lb", "clove", "can", or null for whole countable items (fold the counting word into the name, e.g. name: "garlic cloves"). Keep the whole response concise so it fits comfortably in the response budget. Do not include any text outside the JSON object.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: `Find or create a recipe for: "${query}"` }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "The recipe service returned an error.", detail: errText }),
      };
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      return { statusCode: 502, body: JSON.stringify({ error: "No recipe text was returned." }) };
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: "Couldn't read the recipe format returned." }) };
    }

    if (!parsed.ingredients || !parsed.steps || !parsed.title) {
      return { statusCode: 502, body: JSON.stringify({ error: "The recipe was missing required fields." }) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Unexpected server error." }) };
  }
};
