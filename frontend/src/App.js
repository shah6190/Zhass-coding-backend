import React, { useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { io } from 'socket.io-client';
import hljs from 'highlight.js'; // Core library
import 'highlight.js/lib/languages/ruby'; // Register Ruby language
import 'highlight.js/styles/tokyo-night-dark.css'; // Use Tokyo Night Dark theme

// Register Ruby language with highlight.js
hljs.registerLanguage('ruby', require('highlight.js/lib/languages/ruby'));

const defaultCode = {
  javascript: "console.log('Hello, World!');",
  python: "import unittest\n\nclass TestExample(unittest.TestCase):\n    def test_addition(self):\n        self.assertEqual(1 + 1, 2)\n\nif __name__ == '__main__':\n    unittest.main()",
  ruby: "RSpec.describe \"Example\" do\n  it \"adds numbers correctly\" do\n    expect(1 + 1).to eq(2)\n  end\nend",
  java: "public class Main {\n  public static void main(String[] args) {\n    System.out.println(\"Hello, World!\");\n  }\n}",
  cpp: "#include <iostream>\n\nint main() {\n  std::cout << \"Hello, World!\\n\";\n  return 0;\n}",
  go: "package main\n\nimport \"fmt\"\n\nfunc main() {\n  fmt.Println(\"Hello, World!\")\n}"
};

function App() {
  const [code, setCode] = useState(defaultCode.javascript);
  const [output, setOutput] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [roomId, setRoomId] = useState("");
  const [socket, setSocket] = useState(null);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [userInput, setUserInput] = useState(""); // New state for user input

  useEffect(() => {
    const newSocket = io('https://zhass-coding-backend.onrender.com', {
      withCredentials: true
    });
    setSocket(newSocket);

    return () => newSocket.disconnect();
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('codeUpdate', (newCode) => {
      setCode(newCode);
    });

    return () => {
      socket.off('codeUpdate');
    };
  }, [socket]);

  const createRoom = async () => {
    try {
      const response = await fetch('https://zhass-coding-backend.onrender.com/create-room');
      const data = await response.json();
      setRoomId(data.roomId);
      socket.emit('join-room', data.roomId);
      setIsCollaborating(true);
    } catch (error) {
      console.error("Error creating room:", error);
      setOutput("Error creating room: " + error.message);
    }
  };

  const joinRoom = () => {
    if (roomId) {
      socket.emit('join-room', roomId);
      setIsCollaborating(true);
    }
  };

  const handleCodeChange = (value) => {
    setCode(value);
    if (isCollaborating && roomId) {
      socket.emit('codeChange', roomId, value);
    }
  };

  const fetchWithTimeout = async (url, options, timeout = 120000) => { // Increased timeout to 120 seconds
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const startTime = Date.now();
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const endTime = Date.now();
    console.log(`Fetch took ${endTime - startTime}ms`);
    clearTimeout(id);
    return response;
  };

  const runCode = async () => {
    setOutput("Running...");
    const backendUrl = "https://zhass-coding-backend.onrender.com/run";
    try {
      const response = await fetchWithTimeout(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language, input: userInput }), // Send user input
      }, 120000);
      console.log("Raw response:", response);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log("Parsed response:", data);
      if (data.output && typeof data.output === 'string') {
        if (data.output.includes("error")) {
          setOutput("Error in code execution: " + data.output);
        } else {
          setOutput(data.output);
        }
      } else {
        setOutput("Error: Unexpected response format from backend");
      }
    } catch (error) {
      console.error("Fetch error:", error);
      setOutput("Error: " + error.message);
    }
  };

  const runTests = async () => {
    if (!['python', 'ruby'].includes(language)) {
      setOutput("Test framework not supported for this language.");
      return;
    }

    // Validate Ruby test code
    if (language === 'ruby') {
      const rubyKeywords = ['RSpec', 'describe', 'expect', 'it'];
      const hasRubyTestSyntax = rubyKeywords.some(keyword => code.includes(keyword));
      if (!hasRubyTestSyntax) {
        setOutput("Error: Ruby test code must include RSpec syntax (e.g., 'RSpec.describe', 'expect', 'it')");
        return;
      }
    }

    setOutput("Running tests...");
    try {
      const response = await fetchWithTimeout('https://zhass-coding-backend.onrender.com/run-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language }),
      }, 120000); // Increased timeout to 120 seconds
      console.log("Raw response (tests):", response);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log("Parsed response (tests):", data);
      if (data.output && typeof data.output === 'string') {
        const hasFailure = data.output.includes("failures") && !data.output.includes("0 failures");
        const hasErrorOutsideExamples = data.output.includes("error occurred outside of examples");
        if (hasFailure || hasErrorOutsideExamples || data.output.includes("Error: Container exited with code")) {
          setOutput("Error in test execution: " + data.output);
        } else {
          setOutput(data.output);
        }
      } else {
        setOutput("Error: Unexpected response format from backend");
      }
    } catch (error) {
      console.error("Fetch error (tests):", error);
      setOutput("Error: " + error.message);
    }
  };

  const changeLanguage = (newLanguage) => {
    setLanguage(newLanguage);
    setCode(defaultCode[newLanguage]);
  };

  // Highlight code using highlight.js for display purposes
  const highlightCode = (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return code; // Fallback to plain text if language not supported
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>Zhass Coding</h1>
      
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        marginBottom: '20px',
        alignItems: 'center'
      }}>
        <div>
          <label style={{ marginRight: '10px' }}>
            Language:
            <select
              value={language}
              onChange={(e) => changeLanguage(e.target.value)}
              style={{ 
                marginLeft: '10px', 
                padding: '5px',
                borderRadius: '4px',
                border: '1px solid #ccc'
              }}
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="ruby">Ruby</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
              <option value="go">Go</option>
            </select>
          </label>
        </div>
        
        <div>
          {!isCollaborating ? (
            <>
              <button
                onClick={createRoom}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  marginRight: '10px'
                }}
              >
                Create Room
              </button>
              <input
                type="text"
                placeholder="Enter room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                style={{
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  marginRight: '10px'
                }}
              />
              <button
                onClick={joinRoom}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Join Room
              </button>
            </>
          ) : (
            <div>
              <span style={{ marginRight: '10px' }}>Room: {roomId}</span>
              <button
                onClick={() => setIsCollaborating(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Leave Room
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', height: '60vh' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <CodeMirror
            value={code}
            height="100%"
            extensions={
              language === 'javascript' ? [javascript()] :
              language === 'python' ? [python()] :
              language === 'java' ? [java()] :
              language === 'cpp' ? [cpp()] :
              language === 'go' ? [go()] : []
            }
            onChange={handleCodeChange}
            theme={dracula}
          />
          <div style={{ marginTop: '10px' }}>
            <label>User Input:</label>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              style={{
                width: '100%',
                height: '50px',
                padding: '5px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                marginTop: '5px',
              }}
              placeholder="Enter input for your program (e.g., for Python input(), Ruby gets)"
            />
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '10px' }}>
            <button
              onClick={runCode}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                flex: 1
              }}
            >
              Run Code
            </button>
            <button
              onClick={runTests}
              style={{
                padding: '10px 20px',
                backgroundColor: '#FF9800',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                flex: 1
              }}
            >
              Run Tests
            </button>
          </div>
        </div>
        <div style={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginTop: 0 }}>Output</h3>
          <pre
            style={{
              background: '#282a36',
              color: '#f8f8f2',
              padding: '15px',
              height: '100%',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              borderRadius: '5px',
              flex: 1
            }}
            dangerouslySetInnerHTML={{ __html: output ? highlightCode(output, language) : "No output yet..." }}
          />
        </div>
      </div>
    </div>
  );
}

export default App;