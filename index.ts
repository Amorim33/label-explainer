import { intro, select, text } from "@clack/prompts";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import fs from "fs";
import { generateText } from "ai";

const model = google("gemini-2.0-flash-001");

const validateWithZod =
  (
    schema:
      | z.ZodString
      | z.ZodEffects<z.ZodString>
      | z.ZodEffects<z.ZodEffects<z.ZodString>>
  ) =>
  (value: string): string | Error | undefined => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return result.error.message;
    }

    return undefined;
  };

intro("Label Explainer 🪄");

const action = await select({
  message: "What do you want to do?",
  options: [
    {
      value: "explain-stance-labels-tweets",
      label: "Explain Stance Labels in Tweets",
    },
  ],
});

switch (action) {
  case "explain-stance-labels-tweets": {
    const target = z.string().parse(
      await text({
        message: "Enter the target.",
        validate: validateWithZod(z.string().min(1)),
      })
    );

    const language = z.enum(["portuguese", "english"]).parse(
      await select({
        message: "Enter the language of the dataset.",
        options: [
          { value: "portuguese", label: "Portuguese" },
          { value: "english", label: "English" },
        ],
      })
    );

    const dataset = z
      .string()
      .transform((value) => fs.readFileSync(value, "utf-8"))
      .parse(
        await text({
          message:
            "Enter the dataset path.\n The dataset should be a ';'-separated file.",
          validate: validateWithZod(
            z
              .string()
              .refine((value) => fs.existsSync(value), "Dataset does not exist")
          ),
        })
      );

    const batches: { text: string; label: string }[][] = [[]];
    let lineCount = 0;
    let batchIndex = 0;
    for (const line of dataset.split("\n")) {
      const [text, label] = line.split(";");
      batches[batchIndex].push({ text, label });
      lineCount++;
      if (lineCount === 500) {
        batchIndex++;
        batches.push([]);
        lineCount = 0;
      }
    }

    const promises = batches.map(async (batch) => {
      const { text } = await generateText({
        model,
        prompt: `
**Objective:** To generate clear and concise explanations for why a given tweet is classified as being "for" or "against" a specific target.

**Input:** You will be provided with a dataset of tweets, each with a pre-assigned stance label ("for" or "against") towards a given target.

**Output:** Your task is to generate a ';'-separated output with the following columns: \`text\`, \`label\`, and \`label_explanation\`.

**Instructions:**

For each tweet, carefully analyze the text and its relationship with the designated **${target}**. Your explanation should be based on the following principles:

* **"against" Label:** A tweet is labeled "against" if it expresses a negative sentiment, criticism, opposition, or disagreement with the **${target}**. This can be a direct attack, an expression of disapproval, or the highlighting of negative consequences or aspects related to the **${target}**.
* **"for" Label:** A tweet is labeled "for" if it expresses a positive sentiment, support, agreement, or endorsement of the **${target}**. This can be through direct praise, highlighting benefits, or defending the **${target}** against criticism.

**Your generated \`label_explanation\` should:**

1.  **Directly reference the content of the tweet.** Quote or paraphrase specific words or phrases that are indicative of the stance.
2.  **Clearly state the reasoning.** Explicitly connect the textual evidence to the assigned stance label.
3.  **Be concise and easy to understand.** Aim for a one to two-sentence explanation.
4.  **Remain neutral and objective in your explanation.** Your role is to explain the stance, not to agree or disagree with it.
5.  **Return the explanation in ${language}.**

**Example of Expected Output:**
text;label;label_explanation
eu odeio tudo que o governo Bolsonaro é! não vai ter um dia sequer da minha vida que eu não esteja desejando esse cara fora do comando do país;against;O texto expressa sentimentos negativos explícitos, como 'odeio', e um desejo claro de que o alvo, 'o governo Bolsonaro', seja removido do poder ('desejando esse cara fora do comando do país'), o que demonstra uma forte oposição.
um dos vídeos mais engraçados é o do Bolsonaro fazendo flexão KAKSKSKAKSKAKSKAKSS;against;O texto utiliza o humor e a risada ('KAKSKSKAKSKAKSKAKSS') para se referir a uma ação do alvo (Bolsonaro). Neste contexto, o ato de achar 'engraçado' um vídeo do presidente sugere zombaria ou ridicularização, em vez de apoio, caracterizando uma postura contrária.
Eu tomei multa demais esse ano pqp... Aí agora mudou a lei né? Você vê que tá fazendo merda na vida quando uma lei aprovada pelo Bolsonaro te favorece! Peço perdão desde já viu;for;Apesar do tom irônico e da aparente relutância, o autor admite explicitamente que uma 'lei aprovada pelo Bolsonaro' o favorece. A postura é considerada 'a favor' porque o texto afirma que a ação do alvo (a lei) é benéfica para o autor, independentemente de seus sentimentos pessoais sobre o político.

**Input:**
${batch.map(({ text, label }) => `${text};${label}`).join("\n")}`,
      });

      return text;
    });

    const results = await Promise.all(promises);

    fs.writeFileSync(`results-${target}-${language}.csv`, results.join("\n"));

    break;
  }
  default: {
    throw new Error("Invalid action");
  }
}
