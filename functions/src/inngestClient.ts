import { Inngest } from "inngest";
import { readEnv } from "./env";

export const inngest = new Inngest({
  id: "courserocket",
  signingKey: readEnv("INNGEST_SIGNING_KEY"),
});
