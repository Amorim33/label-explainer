export interface ClassificationPromptParams {
  target: string;
  language: string;
  batch: Array<{ text: string }>;
}

export const getClassificationPrompt = ({ target, language, batch }: ClassificationPromptParams): string => {
  return `
**Objective:** To classify tweets as "for" or "against" a specific target and provide clear explanations for each classification.

**Input:** You will be provided with a list of tweets about **${target}**.

**Output:** Your task is to generate a TSV (tab-separated values) output with the following columns: \`text\`, \`label\`, and \`label_explanation\`.

**Classification Guidelines:**

* **"against" Label:** A tweet should be labeled "against" if it expresses:
  - Negative sentiment, criticism, or opposition towards **${target}**
  - Disagreement with policies, actions, or statements related to **${target}**
  - Mocking, sarcasm, or ridicule directed at **${target}**
  - Expressions of disappointment, anger, or frustration about **${target}**
  - Calls for removal, replacement, or cessation of **${target}**

* **"for" Label:** A tweet should be labeled "for" if it expresses:
  - Positive sentiment, support, or endorsement of **${target}**
  - Agreement with policies, actions, or statements of **${target}**
  - Praise, admiration, or celebration of **${target}**
  - Defense of **${target}** against criticism
  - Expressions of hope, satisfaction, or gratitude related to **${target}**

**Your generated \`label_explanation\` should:**

1. **Quote specific words or phrases** from the tweet that indicate the stance
2. **Clearly connect the evidence to the classification** - explain why these elements indicate "for" or "against"
3. **Be concise** - aim for 1-2 sentences maximum
4. **Remain objective** - explain the stance without personal judgment
5. **Be written in ${language}**
6. **Consider context and tone** - detect sarcasm, irony, or implicit meanings

**Example Output Format:**
text\tlabel\tlabel_explanation

**Input Tweets:**
${batch.map(({ text }) => text).join("\n")}

**Important:** Return ONLY the TSV format with no additional text or headers. Each line should contain exactly: tweet_text[TAB]label[TAB]explanation`;
};