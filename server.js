const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path'); // ✅ صحیح طریقہ

const app = express();
const PORT = 5000;

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.post('/run', (req, res) => {
  const { language, code } = req.body;

  // Input validation
  if (!language || !code) {
    return res.status(400).json({ error: 'Language and code are required.' });
  }

  const languageHandlers = {
    python: {
      file: 'script.py',
      cmd: (filePath) => `python "${filePath}"`
    },
    javascript: {
      file: 'script.js',
      cmd: (filePath) => `node "${filePath}"`
    },
    cpp: {
      file: 'script.cpp',
      cmd: (filePath) => {
        const outFile = filePath.replace('.cpp', '.out');
        return `g++ "${filePath}" -o "${outFile}" && "${outFile}"`;
      }
    },
    java: {
      file: 'Main.java',
      cmd: (filePath) => {
        const dir = path.dirname(filePath);
        return `javac "${filePath}" && java -cp "${dir}" Main`;
      }
    },
    ruby: {
      file: 'script.rb',
      cmd: (filePath) => `ruby "${filePath}"`
    },
    go: {
      file: 'script.go',
      cmd: (filePath) => `go run "${filePath}"`
    }
  };

  const handler = languageHandlers[language.toLowerCase()];
  if (!handler) {
    return res.status(400).json({ error: `Unsupported language: ${language}` });
  }

  const filePath = path.join(tempDir, handler.file);
  
  try {
    // Write code to temporary file
    fs.writeFileSync(filePath, code);
    
    // Execute with timeout (10 seconds)
    const timeout = 10000;
    const startTime = Date.now();
    
    exec(handler.cmd(filePath), { timeout }, (error, stdout, stderr) => {
      // Clean up files
      try {
        fs.unlinkSync(filePath);
        if (language.toLowerCase() === 'cpp') {
          fs.unlinkSync(filePath.replace('.cpp', '.out'));
        }
        if (language.toLowerCase() === 'java') {
          fs.unlinkSync(filePath.replace('.java', '.class'));
        }
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }

      if (error) {
        if (error.killed || Date.now() - startTime >= timeout) {
          return res.status(500).json({ error: 'Execution timed out (10s limit)' });
        }
        return res.status(500).json({ error: stderr || error.message });
      }
      
      res.json({ output: stdout });
    });
  } catch (writeError) {
    console.error('File write error:', writeError);
    res.status(500).json({ error: 'Failed to write temporary file' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('Supported languages: python, javascript, cpp, java, ruby, go');
});
