import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import { PDFDocument } from "pdf-lib";

import { Document, Packer, Paragraph } from "docx";

dotenv.config();
const app = express();
app.use(cors());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Health check
app.get("/", (req, res) => {
  res.send("✅ Backend: Own Your PDF (Vercel ready)");
});

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

    // Get target size from frontend
    let targetSize = req.body.targetSize || "";
    targetSize = targetSize.trim().toLowerCase();

    // Optional: parse targetSize to bytes
    let targetBytes = 0;
    if (targetSize.endsWith("kb")) {
      targetBytes = parseFloat(targetSize) * 1024;
    } else if (targetSize.endsWith("mb")) {
      targetBytes = parseFloat(targetSize) * 1024 * 1024;
    } else if (targetSize) {
      targetBytes = parseFloat(targetSize); // assume bytes if unit not given
    }

    const pdfDoc = await PDFDocument.load(req.file.buffer, {
      updateMetadata: false,
    });

    // Clear metadata for slight size reduction
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

    // Note: At this point, you could implement logic to further compress
    // based on targetBytes if needed. For now, we just send the PDF.

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=compressed.pdf");
    res.send(Buffer.from(compressedPdfBytes));
  } catch (err) {
    console.error("Error compressing PDF:", err);
    res.status(500).send("Error compressing PDF");
  }
});


// -------------------- PDF TO WORD --------------------
app.post("/pdf-to-word", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).send("❌ No PDF file uploaded");
    }

    const pdfDoc = await PDFDocument.load(req.file.buffer);
    let extractedText = "";

    for (const page of pdfDoc.getPages()) {
      const { contents } = page.node;
      if (contents) {
        extractedText += contents.toString() + "\n\n";
      }
    }

    if (!extractedText.trim()) {
      extractedText =
        "⚠️ Could not extract text (maybe scanned or image-based).";
    }

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

// ❌ Word to PDF won't work on Vercel (needs LibreOffice)
// Keep it local or replace with API

console.log("✅ Backend ready for Vercel");

// Export app for Vercel
export default app;
