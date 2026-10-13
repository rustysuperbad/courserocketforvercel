import type OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export type Embedder = (inputs: string[]) => Promise<number[][]>;

export function openAiEmbedder(openai: OpenAI): Embedder {
  return async (inputs) => {
    const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: inputs, dimensions: EMBEDDING_DIMENSIONS });
    return inputs.map((_, index) => {
      const vector = response.data[index]?.embedding;
      if (!vector) throw new Error("OpenAI returned an incomplete embedding batch.");
      return vector;
    });
  };
}
