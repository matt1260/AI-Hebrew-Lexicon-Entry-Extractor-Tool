import cors from "cors";
import express from "express";
import path from "path";
import { promises as fs } from "fs";

const PORT = Number(process.env.PORT ?? 4000);
const app = express();
const lexiconPath = path.resolve(process.cwd(), "public", "lexicon.sqlite");

app.use(cors());

app.get("/status", async (req, res) => {
  try {
    await fs.access(lexiconPath);
    res.json({ lexiconExists: true });
  } catch (error) {
    res.json({ lexiconExists: false, error: error.message });
  }
});

app.get("/lexicon.sqlite", async (req, res) => {
  try {
    await fs.access(lexiconPath);
    res.setHeader("Content-Type", "application/octet-stream");
    res.sendFile(lexiconPath);
  } catch (error) {
    res.status(404).json({ error: "lexicon.sqlite not found" });
  }
});

// Accept raw binary payloads from uploads and overwrite the disk file.
app.post(
  "/lexicon.sqlite",
  express.raw({ type: "*/*", limit: "100mb" }),
  async (req, res) => {
    const fileBody = req.body;
    if (!fileBody || fileBody.length === 0) {
      res.status(400).json({ error: "Request body is empty" });
      return;
    }

    try {
      await fs.mkdir(path.dirname(lexiconPath), { recursive: true });
      await fs.writeFile(lexiconPath, fileBody);
      res.json({ success: true, message: "lexicon.sqlite updated" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Lexicon server running on http://localhost:${PORT}`);
});
