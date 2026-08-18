import { GoogleGenAI, Type } from "@google/genai";

export const AVAILABLE_MODELS = [
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" }
];

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Please ensure it is set in your environment or Secrets.");
  }
  return new GoogleGenAI({ apiKey });
}

async function callGeminiWithFallback(
  prompt: string, 
  schema: any, 
  preferredModel: string = "gemini-2.0-flash",
  isList: boolean = false
) {
  const ai = getAI();
  const modelsToTry = [
    preferredModel,
    ...AVAILABLE_MODELS.map(m => m.id).filter(id => id !== preferredModel)
  ];

  let lastError: any = null;

  for (const modelId of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });

      return JSON.parse(response.text || (isList ? "[]" : "{}"));
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message?.toLowerCase() || "";
      
      // If it's a quota error (429) or model not found (404 sometimes happens with preview models), try next
      if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("rate limit") || errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn(`Model ${modelId} hit limit or not found. Trying fallback...`);
        continue;
      }
      
      if (errorMsg.includes("gemini_api_key")) throw error;
      
      if (error.status >= 500 || error.code >= 500) {
        continue;
      }

      break; 
    }
  }

  throw lastError || new Error("All models failed to respond.");
}

export async function parseMusicLinks(links: string, preferredModel?: string) {
  const prompt = `
    Analyze the following music links and extract information for artists, albums, playlists, or tracks.
    Return a JSON array of objects with the following structure:
    {
      "name": string,
      "url": string,
      "type": "artist" | "album" | "playlist" | "track",
      "imageUrl": string (if possible to guess or find),
      "parentName": string (artist name for albums/tracks, album name for tracks)
    }

    Links:
    ${links}
  `;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        url: { type: Type.STRING },
        type: { 
          type: Type.STRING,
          enum: ["artist", "album", "playlist", "track"]
        },
        imageUrl: { type: Type.STRING },
        parentName: { type: Type.STRING }
      },
      required: ["name", "url", "type"]
    }
  };

  try {
    return await callGeminiWithFallback(prompt, schema, preferredModel || "gemini-2.0-flash", true);
  } catch (error) {
    console.error("Gemini parse error:", error);
    throw error;
  }
}

export async function parsePlaylistSpreadsheet(data: string, preferredModel?: string) {
  const prompt = `
    Analyze the following spreadsheet data representing music playlists.
    Map each row to a JSON object with the following structure:
    {
      "name": string (the title),
      "url": string (the playlist URL),
      "imageUrl": string (cover image if provided in columns),
      "subtitle": string,
      "songCount": number,
      "durationSeconds": number (convert string durations to total seconds),
      "creator": string,
      "creatorUrl": string,
      "relevance": number,
      "tags": string[],
      "type": "playlist"
    }

    Data:
    ${data}
  `;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        url: { type: Type.STRING },
        imageUrl: { type: Type.STRING },
        subtitle: { type: Type.STRING },
        songCount: { type: Type.NUMBER },
        durationSeconds: { type: Type.NUMBER },
        creator: { type: Type.STRING },
        creatorUrl: { type: Type.STRING },
        relevance: { type: Type.NUMBER },
        tags: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING } 
        },
        type: { type: Type.STRING, enum: ["playlist"] }
      },
      required: ["name", "url", "type"]
    }
  };

  try {
    return await callGeminiWithFallback(prompt, schema, preferredModel || "gemini-2.0-flash", true);
  } catch (error) {
    console.error("Gemini spreadsheet parse error:", error);
    throw error;
  }
}

export async function parseAlbumSpreadsheet(data: string, preferredModel?: string) {
  const prompt = `
    Analyze the following spreadsheet data representing music albums.
    Map each row to a JSON object with the following structure:
    {
      "name": string (Album Name),
      "url": string (Album URL),
      "imageUrl": string (Album Cover Image),
      "parentName": string (Artist Name),
      "artistUrl": string (Artist URL),
      "releaseDate": string (Album Date),
      "type": "album"
    }

    Columns provided: Album Date, Album URL, Album Cover Image, Album Name, Artist Name, Artist URL.

    Data:
    ${data}
  `;

  const schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        url: { type: Type.STRING },
        imageUrl: { type: Type.STRING },
        parentName: { type: Type.STRING },
        artistUrl: { type: Type.STRING },
        releaseDate: { type: Type.STRING },
        type: { type: Type.STRING, enum: ["album"] }
      },
      required: ["name", "url", "type", "parentName"]
    }
  };

  try {
    return await callGeminiWithFallback(prompt, schema, preferredModel || "gemini-2.0-flash", true);
  } catch (error) {
    console.error("Gemini album spreadsheet parse error:", error);
    throw error;
  }
}

export async function analyzeItem(item: any, existingTags: string[] = [], preferredModel?: string) {
  const prompt = `
    Analyze this music item and provide enhanced metadata.
    Title: ${item.name}
    Type: ${item.type}
    ${item.subtitle ? `Subtitle: ${item.subtitle}` : ''}
    ${item.creator ? `Creator: ${item.creator}` : ''}
    ${item.parentName ? `Parent/Artist: ${item.parentName}` : ''}
    Existing Vault Tags (for reference): ${existingTags.join(', ')}

    Specific Instructions:
    1. Be very precise with genres.
    2. For Brazilian music: Be highly specific with rhythms. Distinguish between "forró", "partido-alto", "boi-bumbá", "samba-enredo", "choro", "mpb", "baile-funk", "samba-rock", etc. 
       NEVER use "world-music" for Brazilian music. It is Brazilian music.
    3. For World Music generally: Be as specific as possible. For Japanese traditions, use terms like "koto", "shakuhachi", "enka", "gagaku", "minyo". 
       For African rhythms, distinguish between "highlife", "afrobeat", "ethio-jazz", etc.
       Apply this level of specificity to rhythms from all cultures.
    4. Tags MUST ALWAYS be lower-case/kebab-case.

    Return a JSON object with:
    - tags: string[] (suggest 5-10 descriptive tags, ALWAYS in kebab-case or lower-case, e.g. "lo-fi", "jazz-fusion"). 
      Check the "Existing Vault Tags" and prefer matches if they describe the vibe well.
    - genres: string (comma-separated specific genres and subgenres)
    - rhythms: string (comma-separated specific rhythmic patterns, time signatures, or groove styles)
    ${item.type === 'artist' ? '- relatedToSource: string (associated labels, collaborating artists, movements, or musical origins)' : ''}
    ${item.type === 'track' ? '- bpm: number (estimated tempo in beats per minute, or null if unknown)\n    - key: string (musical key, e.g. "C Major", "A Minor", or null)\n    - instrumentationDetails: string (prominent instruments and sound design elements, e.g. "Moog bass, acoustic Rhodes, brushed drums")' : ''}
    - notes: string (a brief summary or description of the vibe)
    - rating: number (0-100, based on perceived high-quality curation if you can infer it, else 50)
    - imageUrl: string (If you can determine or construct the cover image URL from the link/name, such as a Qobuz cover image, provide it here. Otherwise, return null or empty string)
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      genres: { type: Type.STRING },
      rhythms: { type: Type.STRING },
      relatedToSource: { type: Type.STRING },
      bpm: { type: Type.NUMBER },
      key: { type: Type.STRING },
      instrumentationDetails: { type: Type.STRING },
      notes: { type: Type.STRING },
      rating: { type: Type.NUMBER },
      imageUrl: { type: Type.STRING }
    },
    required: ["tags", "notes", "rating"]
  };

  try {
    return await callGeminiWithFallback(prompt, schema, preferredModel || "gemini-2.0-flash", false);
  } catch (error) {
    console.error("Gemini analysis error:", error);
    throw error;
  }
}

export async function clusterTagsWithAI(tags: string[], preferredModel?: string) {
  const prompt = `
    You are an expert music curator, musicologist, and tags categorizer.
    Analyze this list of music tags and automatically group them into 3 to 7 thematic clusters (categories).
    The themes should be creative, human-readable, and describe real music domains (genres, rhythms, styles, eras, origins, or moods).

    Rules:
    1. A tag can belong to more than one cluster if it fits multiple themes (e.g. "bossa-nova" can belong to both "Mellow & Chill" and "Brazilian Vibes").
    2. Every single tag in the input list must belong to at least one cluster.
    3. The cluster names must be cohesive and elegant, for example: "Jazz & Fusion Odyssey", "Brazilian Trad & Mod Vibes", "Electronic Atmospheres", "Warm Acoustic Vibe", "Cosmic & Deep", "Rhythms of the Diaspora".
    4. Each cluster must have a short, evocative description explaining its theme.

    Input Tags to Cluster:
    ${tags.join(", ")}
  `;

  const schema = {
    type: Type.OBJECT,
    properties: {
      clusters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Display name of the cluster" },
            tags: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "The list of tags belonging to this cluster"
            },
            description: { type: Type.STRING, description: "A brief, evocative sentence explaining the cluster's mood/style" }
          },
          required: ["name", "tags", "description"]
        }
      }
    },
    required: ["clusters"]
  };

  try {
    return await callGeminiWithFallback(prompt, schema, preferredModel || "gemini-2.0-flash", false);
  } catch (error) {
    console.error("Gemini tag clustering error:", error);
    throw error;
  }
}

