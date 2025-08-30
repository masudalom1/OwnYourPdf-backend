import express from "express";
import dotenv from "dotenv";
dotenv.config();
import cors from "cors";
import multer from "multer";
import { PDFDocument } from "pdf-lib";
import { PDFImage } from "pdf-image";

// word to pdf 
import { exec } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

import { Document, Packer, Paragraph } from "docx";

const app = express();
app.use(cors());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

app.get("/",(req,res)=>{
  res.send("Backend : Own Your Pdf")
})

// -------------------- MERGE PDFs --------------------
app.post("/merge", upload.array("pdfs"), async (req, res) => {
  try {
    const order = req.body.order
      ? JSON.parse(req.body.order)
      : req.files.map((_, i) => i);
    const mergedPdf = await PDFDocument.create();

    for (let idx of order) {
      const file = req.files[idx];
      if (!file) continue;
      const pdf = await PDFDocument.load(file.buffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedPdfFile = await mergedPdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=merged.pdf");
    res.send(Buffer.from(mergedPdfFile));
  } catch (err) {
    console.error("Error merging PDFs:", err);
    res.status(500).send("Error merging PDFs");
  }
});

// -------------------- SPLIT PDF --------------------
app.post("/split", upload.single("pdf"), async (req, res) => {
  try {
    const { pages } = req.body;
    if (!req.file || !pages)
      return res.status(400).send("PDF file and pages are required");

    const pageNumbers = JSON.parse(pages);
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    const newPdf = await PDFDocument.create();

    for (let num of pageNumbers) {
      if (num > 0 && num <= pdfDoc.getPageCount()) {
        const [page] = await newPdf.copyPages(pdfDoc, [num - 1]);
        newPdf.addPage(page);
      }
    }

    const splitPdfBytes = await newPdf.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=split.pdf");
    res.send(Buffer.from(splitPdfBytes));
  } catch (err) {
    console.error("Error splitting PDF:", err);
    res.status(500).send("Error splitting PDF");
  }
});

// -------------------- COMPRESS PDF --------------------
app.post("/compress", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("PDF file is required");

    const pdfDoc = await PDFDocument.load(req.file.buffer, {
      updateMetadata: false,
    });
    pdfDoc.setTitle("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer("");
    pdfDoc.setCreator("");

    const compressedPdfBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=compressed.pdf");
    res.send(Buffer.from(compressedPdfBytes));
  } catch (err) {
    console.error("Error compressing PDF:", err);
    res.status(500).send("Error compressing PDF");
  }
});

// -------------------- PDF TO WORD (TEXT ONLY, NO pdf-parse) --------------------
app.post("/pdf-to-word", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).send("❌ No PDF file uploaded");
    }

    // Load the PDF
    const pdfDoc = await PDFDocument.load(req.file.buffer);
    let extractedText = "";

    // Loop through all pages and extract text
    for (const page of pdfDoc.getPages()) {
      // pdf-lib does not have direct text extraction,
      // but we can attempt to get contentStream (basic text extraction)
      const { contents } = page.node;
      if (contents) {
        const contentString = contents.toString(); // crude fallback
        extractedText += contentString + "\n\n";
      }
    }

    if (!extractedText.trim()) {
      extractedText =
        "⚠️ Could not extract text from this PDF (maybe scanned or image-based).";
    }

    // Create Word document
    const doc = new Document({
      sections: [
        {
          children: extractedText
            .split("\n")
            .map((line) => new Paragraph(line || " ")),
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    // Send Word file
    res.setHeader("Content-Disposition", "attachment; filename=converted.docx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.send(buffer);
  } catch (err) {
    console.error("❌ Error converting PDF to Word:", err);
    res.status(500).send("Error converting PDF to Word");
  }
});

// -------------------- WORD TO PDF --------------------
app.post("/word-to-pdf", upload.single("word"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send("Word file is required");

    // Temporary file paths
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `word-${Date.now()}.docx`);
    const outputPath = inputPath.replace(".docx", ".pdf");

    // Write uploaded file buffer to temp .docx
    fs.writeFileSync(inputPath, req.file.buffer);

    // Run LibreOffice to convert
    exec(
      `soffice --headless --convert-to pdf --outdir ${tmpDir} ${inputPath}`,
      (err) => {
        if (err) {
          console.error("Conversion error:", err);
          fs.unlinkSync(inputPath);
          return res.status(500).send("Conversion failed");
        }

        // Send PDF back
        res.download(outputPath, "converted.pdf", (err) => {
          try {
            // Cleanup after response
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          } catch (e) {
            console.error("Cleanup error:", e);
          }
        });
      }
    );
  } catch (err) {
    console.error("❌ Error converting Word to PDF:", err);
    res.status(500).send("Error converting Word to PDF");
  }
});



const PORT = process.env.PORT || 5000;

console.log(`🚀 Server running at http://localhost:${PORT}`)

