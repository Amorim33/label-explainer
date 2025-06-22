<img src="https://github.com/user-attachments/assets/efad3311-43d9-4342-923e-84ee37915e4d" width="200" />

# 🪄 Label Explainer CLI

A modern CLI that adds **natural language explanations** to labeled datasets using Google Gemini.
Primarily designed to generate explanations for the [**UStanceBR** corpus](https://arxiv.org/abs/2312.06374) — a collection of stance detection datasets, composed by tweets annotated with **"for"** or **"against"** labels across multiple political targets.

## 🚀 Getting Started
https://github.com/user-attachments/assets/dec28b4c-53fe-455b-9d4d-6e92c953cda3

### 1. **Install Bun**

This project uses [**Bun**](https://bun.sh/) — an ultra-fast JavaScript runtime.

If you don’t have it yet:

```bash
curl -fsSL https://bun.sh/install | bash
```

For more options, visit the official [Bun installation guide](https://bun.sh/docs/installation).

### 2. **Set Your Environment Key**

Create a `.env` file in the root of the project with your **Google Generative AI** key:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key_here
```

You can get an API key by visiting [Google AI Studio](https://makersuite.google.com/app) and creating a project.

### 3. **Run the CLI**

```bash
bun start
```

You’ll be prompted to:

- Choose your task
- Define the dataset format (CSV or TSV)
- Select a language (English or Portuguese)
- Enter your target (e.g., "Bolsonaro")
- Provide the path to your labeled dataset

> 🔁 Your dataset will be processed in batches of 100 entries, and a new TSV will be generated with label explanations.

## 🤝 Contributing

This CLI is open for **expansion to other datasets**, **LLM providers**, **prompts** and **NLP tasks** (e.g., sentiment explanation, topic labeling, etc.).

### How to contribute:

- Open an issue with your idea or request
- Fork the repo and send a pull request
- Suggest new tasks or input formats — we’re flexible!

## 📂 Example Output

Output is saved as a `.tsv` file and includes:

| text                                       | label   | label_explanation                                    |
| ------------------------------------------ | ------- | ---------------------------------------------------- |
| _eu odeio tudo que o governo Bolsonaro é!_ | against | O texto expressa sentimentos negativos explícitos... |
| _Peço perdão desde já viu_                 | for     | Apesar do tom irônico, o autor admite...             |

## 🏁 License

MIT — do what you want, just give credit ✨
