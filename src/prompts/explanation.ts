export interface ExplanationPromptParams {
  target: string;
  language: string;
  batch: Array<{ text: string; label: string }>;
}

export const getExplanationPrompt = ({ target, language, batch }: ExplanationPromptParams): string => {
  return `
**Objective:** To generate clear and concise explanations for why a given tweet is classified as being "for" or "against" a specific target.

**Input:** You will be provided with a dataset of tweets, each with a pre-assigned stance label ("for" or "against") towards a given target.

**Output:** Your task is to generate a TSV (tab-separated values) output with the following columns: \`text\`, \`label\`, and \`label_explanation\`.

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
text\tlabel\tlabel_explanation
eu odeio tudo que o governo Bolsonaro é! não vai ter um dia sequer da minha vida que eu não esteja desejando esse cara fora do comando do país\tagainst\tO texto expressa sentimentos negativos explícitos, como 'odeio', e um desejo claro de que o alvo, 'o governo Bolsonaro', seja removido do poder ('desejando esse cara fora do comando do país'), o que demonstra uma forte oposição.
um dos vídeos mais engraçados é o do Bolsonaro fazendo flexão KAKSKSKAKSKAKSKAKSS\tagainst\tO texto utiliza o humor e a risada ('KAKSKSKAKSKAKSKAKSS') para se referir a uma ação do alvo (Bolsonaro). Neste contexto, o ato de achar 'engraçado' um vídeo do presidente sugere zombaria ou ridicularização, em vez de apoio, caracterizando uma postura contrária.
Eu tomei multa demais esse ano pqp... Aí agora mudou a lei né? Você vê que tá fazendo merda na vida quando uma lei aprovada pelo Bolsonaro te favorece! Peço perdão desde já viu\tfor\tApesar do tom irônico e da aparente relutância, o autor admite explicitamente que uma 'lei aprovada pelo Bolsonaro' o favorece. A postura é considerada 'a favor' porque o texto afirma que a ação do alvo (a lei) é benéfica para o autor, independentemente de seus sentimentos pessoais sobre o político.

**Input:**
${batch.map(({ text, label }) => `${text}\t${label}`).join("\n")}`;
};