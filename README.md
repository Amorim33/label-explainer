<img src="https://github.com/user-attachments/assets/efad3311-43d9-4342-923e-84ee37915e4d" width="200" />

# 🪄 Label Explainer CLI

A modern CLI that adds **natural language explanations** to labeled datasets using AI models (Google Gemini and OpenAI GPT).

This tool is primarily designed for the [**UStanceBR** corpus](https://arxiv.org/abs/2312.06374) — a collection of stance detection datasets, composed by tweets annotated with **"for"** or **"against"** labels across multiple political targets. It performs two main tasks:

1. **Explanation Generation**: Generates explanations for existing human-labeled data
2. **Classification + Explanation**: Classifies unlabeled text and provides explanations for the classifications

## 📋 Features

- **Dual Processing**: Explains human labels AND performs LLM classification with explanations
- **Batch Processing**: Processes data in batches of 100 for efficiency
- **Checkpoint System**: Automatically saves progress and can resume from interruptions
- **Multi-Model Support**: Works with GPT-5, Gemini 2.0 Flash, and Gemini 2.5 Pro
- **Excel Compatibility**: Reads and writes Excel files with structured data

## 🚀 Getting Started

### Prerequisites

1. **Install Bun** (JavaScript runtime):
   ```bash
   curl -fsSL https://bun.sh/install | bash
   ```
   For more options, visit the [Bun installation guide](https://bun.sh/docs/installation).

2. **Clone the Repository**:
   ```bash
   git clone https://github.com/yourusername/label-explainer.git
   cd label-explainer
   ```

3. **Install Dependencies**:
   ```bash
   bun install
   ```

4. **Set Up API Keys**:
   Create a `.env` file in the root directory:
   ```bash
   # For Google Gemini models:
   GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key_here

   # For OpenAI GPT models:
   OPENAI_API_KEY=your_openai_api_key_here
   ```

   - Get Google API key: [Google AI Studio](https://makersuite.google.com/app)
   - Get OpenAI API key: [OpenAI Platform](https://platform.openai.com/api-keys)

## 📂 Data Setup

1. **Create Data Directory**:
   ```bash
   mkdir train_test
   ```

2. **Prepare Your Excel Files**:
   Place your Excel files in the `train_test` directory with the following naming convention:
   - Training files: `{target}_train.xlsx`
   - Test files: `{target}_test.xlsx`

   Example: `bolsonaro_train.xlsx`, `bolsonaro_test.xlsx`

3. **Excel File Format**:
   Your Excel files should have the following structure:
   - Column A: Tweet text
   - Column C: Label (for/against) - for explanation tasks

   The tool will add:
   - Column G: Human label explanations
   - Column H: LLM-generated labels
   - Column I: LLM label explanations

## 🎯 Running the Tool

### Basic Usage

Process all targets with the default model (Gemini 2.0 Flash):
```bash
bun run process
```

### Advanced Options

```bash
# Use a specific model
bun run process -m gemini-2.5-pro

# Process specific targets with specific model
bun run process -m gpt-5 -t bolsonaro -t lula

# Clear previous checkpoints and start fresh
bun run process --clear-checkpoints

# Show help
bun run process --help
```

### Available Models
- `gemini-2.0-flash` (default) - Fast and efficient
- `gemini-2.5-pro` - More accurate but slower
- `gpt-5` - OpenAI's latest model (used with low thinking)

### Available Targets
Default targets for UStanceBR corpus:
- `bolsonaro`
- `cloroquina`
- `coronavac`
- `globo`
- `igreja`
- `lula`

## 🔄 Processing Workflow

The tool performs the following steps for each dataset:

1. **Load Data**: Reads Excel files from `train_test` directory
2. **Explain Human Labels**: Generates explanations for existing labels
3. **Classify with LLM**: Uses AI to classify texts independently
4. **Generate LLM Explanations**: Provides explanations for AI classifications
5. **Save Results**: Outputs processed Excel file with all annotations

## 📁 Project Structure

```
label-explainer/
├── src/
│   ├── prompts/           # AI prompt templates
│   │   ├── explanation.ts # Prompt for explaining existing labels
│   │   └── classification.ts # Prompt for classifying and explaining
│   ├── services/          # Core services
│   │   ├── batch-processor.ts # Batch processing logic
│   │   ├── checkpoint.ts  # Progress saving/resuming
│   │   └── excel.ts       # Excel file operations
│   ├── utils/             # Utility functions
│   │   ├── common.ts      # Common utilities
│   │   └── models.ts      # AI model configurations
│   ├── process.ts        # Main processing script
│   └── compare.ts        # Comparison tool
├── train_test/           # Input data directory
├── dataset/
│   └── checkpoints/      # Progress checkpoints
└── README.md
```

## 💾 Checkpoint System

The tool automatically saves progress after each batch:
- Checkpoints are stored in `dataset/checkpoints/`
- If processing is interrupted, simply run the command again to resume
- Use `--clear-checkpoints` to start fresh

## 📊 Output Format

The tool generates Excel files with the following columns:

| Column | Content |
|--------|---------|
| A | Original text |
| C | Human label (if provided) |
| G | Human label explanation |
| H | LLM-generated label |
| I | LLM label explanation |

Output files are named: `processed-{model}-{target}-{train/test}.xlsx`

### Adding New Models

1. Update `src/utils/models.ts` with your model configuration
2. Add the model type to `ModelType` type definition
3. Update the model selection logic

### Customizing Prompts

Prompts are stored in `src/prompts/`:
- `explanation.ts` - For explaining existing labels
- `classification.ts` - For classification tasks

## 📝 License

MIT — do what you want, just give credit ✨

## 🙏 Acknowledgments

Built for processing the [UStanceBR corpus](https://arxiv.org/abs/2312.06374) and designed to be extensible for other NLP tasks.