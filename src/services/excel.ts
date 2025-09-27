import ExcelJS from "exceljs";

export const readExcelFile = async (filePath: string): Promise<string[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(1);

  const texts: string[] = [];
  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const cellValue = row.getCell(1).value;
      if (cellValue) {
        texts.push(cellValue.toString());
      }
    }
  });

  return texts;
};

export const readExcelFileWithLabels = async (
  filePath: string
): Promise<{ text: string; label: string }[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(1);

  const dataRows: { text: string; label: string }[] = [];
  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const text = row.getCell(1).value?.toString() || "";
      const label = row.getCell(3).value?.toString() || "";
      if (text && label) {
        dataRows.push({ text, label });
      }
    }
  });

  return dataRows;
};

export const writeExcelFile = async (
  filePath: string,
  data: Array<{ text: string, label: string, explanation: string }>
) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Results');

  worksheet.addRow(['text', 'label', 'label_explanation']);

  data.forEach(row => {
    worksheet.addRow([row.text, row.label, row.explanation]);
  });

  worksheet.columns.forEach(column => {
    column.width = 30;
  });

  await workbook.xlsx.writeFile(filePath);
};

export const updateExcelWithExplanations = async (
  originalPath: string,
  explanations: Array<{ text: string, explanation: string }>,
  outputPath: string
) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(originalPath);
  const worksheet = workbook.getWorksheet(1);

  const explanationMap = new Map<string, string>();
  explanations.forEach(item => {
    explanationMap.set(item.text.trim(), item.explanation);
  });

  let headerRow = worksheet?.getRow(1);
  if (headerRow) {
    headerRow.getCell(7).value = 'human_label_explanation';
  }

  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const text = row.getCell(1).value?.toString()?.trim() || "";
      const explanation = explanationMap.get(text);
      if (explanation) {
        row.getCell(7).value = explanation;
      }
    }
  });

  worksheet?.columns.forEach(column => {
    column.width = 30;
  });

  await workbook.xlsx.writeFile(outputPath);
};

export const updateExcelWithClassifications = async (
  basePath: string,
  classifications: Array<{ text: string, label: string, explanation: string }>,
  outputPath: string
) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(basePath);
  const worksheet = workbook.getWorksheet(1);

  const classificationMap = new Map<string, { label: string, explanation: string }>();
  classifications.forEach(item => {
    classificationMap.set(item.text.trim(), { label: item.label, explanation: item.explanation });
  });

  let headerRow = worksheet?.getRow(1);
  if (headerRow) {
    headerRow.getCell(8).value = 'llm_label';
    headerRow.getCell(9).value = 'llm_label_explanation';
  }

  worksheet?.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      const text = row.getCell(1).value?.toString()?.trim() || "";
      const classification = classificationMap.get(text);
      if (classification) {
        row.getCell(8).value = classification.label;
        row.getCell(9).value = classification.explanation;
      }
    }
  });

  worksheet?.columns.forEach(column => {
    column.width = 30;
  });

  await workbook.xlsx.writeFile(outputPath);
};