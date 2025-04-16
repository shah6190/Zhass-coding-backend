const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Docker = require('dockerode');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const net = require('net');
const axios = require('axios');

require('dotenv').config();

const app = express();
const docker = new Docker();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['https://zhass-coding-frontend.vercel.app', 'http://localhost:3000'],
  },
});

app.use(cors({
  origin: ['https://zhass-coding-frontend.vercel.app', 'http://localhost:3000'],
}));
app.use(bodyParser.json());

// Pre-pull Docker images to improve performance
(async () => {
  try {
    await docker.pull('node:18');
    await docker.pull('python:3.9-slim');
    await docker.pull('ruby:3.2-slim');
    await docker.pull('ruby-rspec:3.2-slim');
    await docker.pull('openjdk:11-slim');
    await docker.pull('gcc:12');
    await docker.pull('golang:latest');
    console.log("All images pre-pulled");
  } catch (error) {
    console.error("Error pre-pulling images:", error.message);
  }
})();

app.get('/', (req, res) => {
  res.send('Hello from Zhass Coding Backend!');
});

app.get('/create-room', (req, res) => {
  const roomId = uuidv4();
  res.json({ roomId });
});

app.post('/generate-code', async (req, res) => {
  const { prompt, language = 'html' } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required and must be a string' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: `Generate ${language} code for: ${prompt}`,
              },
            ],
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const generatedCode = response.data.candidates[0].content.parts[0].text.trim();
    res.json({ code: generatedCode });
  } catch (error) {
    console.error('Error generating code:', error.message);
    res.status(500).json({ error: 'Failed to generate code: ' + error.message });
  }
});

app.post('/run', async (req, res) => {
  const { code, language = 'javascript', input = '' } = req.body;
  console.log("Received:", { code, language, input });

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ output: 'Code is required and must be a string' });
  }

  let container;
  try {
    const fs = require('fs');
    const path = require('path');
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    let filePath, image, cmd, outputPath;
    if (language === 'javascript') {
      filePath = path.join(tempDir, `script-${Date.now()}.js`);
      image = 'node:18';
      cmd = ['node', `/app/${path.basename(filePath)}`];
    } else if (language === 'python') {
      filePath = path.join(tempDir, `script-${Date.now()}.py`);
      image = 'python:3.9-slim';
      cmd = ['python', `/app/${path.basename(filePath)}`];
    } else if (language === 'cpp') {
      filePath = path.join(tempDir, `script-${Date.now()}.cpp`);
      outputPath = path.join(tempDir, `a.out`);
      image = 'gcc:12';
      cmd = [
        'sh',
        '-c',
        `g++ /app/${path.basename(filePath)} -o /app/a.out && /app/a.out`,
      ];
    } else if (language === 'java') {
      filePath = path.join(tempDir, `Main.java`);
      image = 'openjdk:11-slim';
      cmd = [
        'sh',
        '-c',
        `javac /app/Main.java && java -cp /app Main`,
      ];
    } else if (language === 'go') {
      filePath = path.join(tempDir, `main-${Date.now()}.go`);
      image = 'golang:latest';
      cmd = ['go', 'run', `/app/${path.basename(filePath)}`];
    } else if (language === 'ruby') {
      filePath = path.join(tempDir, `script-${Date.now()}.rb`);
      image = 'ruby:3.2-slim';
      cmd = ['ruby', `/app/${path.basename(filePath)}`];
    } else {
      return res.status(400).json({ output: `Language ${language} not supported yet` });
    }

    console.log(`Creating file: ${filePath}`);
    fs.writeFileSync(filePath, code);

    console.log(`Creating container with image: ${image}`);
    container = await docker.createContainer({
      Image: image,
      Cmd: ['tail', '-f', '/dev/null'],
      HostConfig: {
        Binds: [`${path.join(__dirname, 'temp')}:/app`],
        AutoRemove: true,
        Memory: 1024 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 100000,
      },
      Tty: false,
    }).catch(err => {
      throw new Error(`Failed to create container: ${err.message}`);
    });

    console.log("Starting container...");
    await container.start().catch(err => {
      throw new Error(`Failed to start container: ${err.message}`);
    });

    console.log(`Executing command in container: ${cmd}`);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    }).catch(err => {
      throw new Error(`Failed to create exec instance: ${err.message}`);
    });

    console.log("Starting exec...");
    const stream = await exec.start({ hijack: true, stdin: true }).catch(err => {
      throw new Error(`Failed to start exec: ${err.message}`);
    });

    if (input) {
      console.log("Writing input to exec stream...");
      stream.write(input + '\n');
    }

    let output = '';
    stream.on('data', (data) => {
      const text = data.slice(8).toString('utf8');
      output += text;
      console.log("Exec stream data:", text);
    });

    stream.on('end', async () => {
      console.log("Exec stream ended");
      try {
        const execStatus = await exec.inspect();
        console.log("Exec status:", execStatus);
        if (execStatus.ExitCode !== 0) {
          output += `\nError: Exec exited with code ${execStatus.ExitCode}`;
        }
      } catch (error) {
        output += `\nError inspecting exec: ${error.message}`;
        console.error("Error inspecting exec:", error.message);
      } finally {
        stream.end();
        fs.unlinkSync(filePath);
        if (language === 'cpp' && outputPath && fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        console.log("Sending response:", output);
        res.json({ output });
      }
    });

    stream.on('error', (error) => {
      output += `\nExec stream error: ${error.message}`;
      console.error("Exec stream error:", error.message);
      stream.end();
      res.status(500).json({ output });
    });
  } catch (error) {
    console.error(`Error for language ${language}:`, error.message);
    if (container) {
      try {
        await container.stop();
        await container.remove();
      } catch (stopError) {
        console.error("Error stopping/removing container:", stopError.message);
      }
    }
    res.status(500).json({ output: "Error: " + error.message });
  }
});

app.post('/run-tests', async (req, res) => {
  const { code, language = 'python', input = '' } = req.body;
  console.log("Received test:", { code, language, input });

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ output: 'Code is required and must be a string' });
  }

  if (language === 'python') {
    const pythonTestKeywords = ['unittest.TestCase', 'self.assert'];
    const hasPythonTestSyntax = pythonTestKeywords.some(keyword => code.includes(keyword));
    if (!hasPythonTestSyntax) {
      return res.status(400).json({ output: "Error: Python test code must include unittest syntax (e.g., 'unittest.TestCase', 'self.assert')" });
    }
  }

  let container;
  try {
    const fs = require('fs');
    const path = require('path');
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    let filePath, image, cmd;
    if (language === 'python') {
      filePath = path.join(tempDir, `test-${Date.now()}.py`);
      image = 'python:3.9-slim';
      cmd = ['python', '-m', 'unittest', `/app/${path.basename(filePath)}`];
    } else if (language === 'ruby') {
      filePath = path.join(tempDir, `test-${Date.now()}.rb`);
      image = 'ruby-rspec:3.2-slim';
      cmd = ['rspec', `/app/${path.basename(filePath)}`, '--format', 'documentation'];
    } else {
      return res.status(400).json({ output: `Test framework for ${language} not supported yet` });
    }

    console.log(`Creating test file: ${filePath}`);
    fs.writeFileSync(filePath, code);

    console.log(`Creating container for test with image: ${image}, cmd: ${cmd}`);
    container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      HostConfig: {
        Binds: [`${path.join(__dirname, 'temp')}:/app`],
        AutoRemove: true,
        Memory: 1024 * 1024 * 1024,
        CpuPeriod: 100000,
        CpuQuota: 100000,
      },
      Tty: false,
    }).catch(err => {
      throw new Error(`Failed to create container: ${err.message}`);
    });

    console.log("Starting test container...");
    await container.start().catch(err => {
      throw new Error(`Failed to start container: ${err.message}`);
    });

    let stdinStream;
    if (input) {
      console.log("Attaching to container stdin for tests...");
      stdinStream = await container.attach({
        stream: true,
        stdin: true,
      });
      stdinStream.write(input + '\n');
    }

    console.log("Fetching test container logs...");
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    }).catch(err => {
      throw new Error(`Failed to fetch container logs: ${err.message}`);
    });

    let output = '';
    stream.on('data', (data) => {
      const text = data.slice(8).toString('utf8');
      output += text;
      console.log("Test stream data:", text);
    });

    stream.on('end', async () => {
      console.log("Test stream ended");
      try {
        const containerStatus = await container.wait();
        console.log("Test container status:", containerStatus);
        if (containerStatus.StatusCode !== 0) {
          output += `\nError: Test container exited with code ${containerStatus.StatusCode}`;
        }
      } catch (error) {
        output += `\nError waiting for test container: ${error.message}`;
        console.error("Error waiting for test container:", error.message);
      } finally {
        if (stdinStream) {
          stdinStream.end();
        }
        fs.unlinkSync(filePath);
        console.log("Sending test response:", output);
        res.json({ output });
      }
    });

    stream.on('error', (error) => {
      output += `\nTest stream error: ${error.message}`;
      console.error("Test stream error:", error.message);
      if (stdinStream) {
        stdinStream.end();
      }
      res.status(500).json({ output });
    });
  } catch (error) {
    console.error(`Error for test language ${language}:`, error.message);
    if (container) {
      try {
        await container.stop();
        await container.remove();
      } catch (stopError) {
        console.error("Error stopping/removing test container:", stopError.message);
      }
    }
    res.status(500).json({ output: "Error: " + error.message });
  }
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('codeChange', (roomId, newCode) => {
    socket.to(roomId).emit('codeUpdate', newCode);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

async function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') reject(new Error(`Port ${port} is in use`));
      else reject(err);
    });
    server.once('listening', () => {
      server.close();
      resolve();
    });
    server.listen(port);
  });
}

const PORT = process.env.PORT || 5000;
async function startServer() {
  try {
    await checkPort(PORT);
    server.listen(PORT, () => {
      console.log(`Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
startServer();

process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});