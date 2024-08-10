import { WebSocketServer } from 'ws';
import { execSync } from 'child_process';
import fs from "fs";

const wss = new WebSocketServer({ port: 8080 });

const MAX_LENGTH = 230;

if(!fs.existsSync("correctAnswers.txt")) {
    fs.writeFileSync("correctAnswers.txt", "");
}
let knownCorrectAnswers = fs.readFileSync("correctAnswers.txt").toString().split("\n");

function getPrompt(previousGuesses, currentGuess) {
    return `Determine an item or concept that would beat "${currentGuess}" \
in an alternative, extreme, version of Rock Paper Scissors where any answer is valid. \
Be creative and do not repeat answers. Do not add punctuation to your answer. \
Keep your answers relatively short, simple, and ensure you'll acquire a decisive win! \
Previous answers include ${previousGuesses.slice(0, previousGuesses.length - 1).map(e => `"${e}"`).join(", ")}, and "rock"; \
DO NOT repeat these. As an example, "drought" could beat "water", and "rust" could beat "scissors". \
Answer with only the item or concept; do not add extra text. \
What would beat "${currentGuess}" in this game?`;
}

wss.on('connection', (ws) => {
    ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        switch(message.type) {
            case "failure": {
                console.log(`\x1b[1;31mIncorrectly answered with ${message.latestAnswer}.\x1b[0m Correct answer streak:
    ${message.correctAnswers.join(" -> ")}
`);

                knownCorrectAnswers = message.correctAnswers;
                fs.writeFileSync("correctAnswers.txt", knownCorrectAnswers.join("\n"));
                console.log("Correct answers saved to correctAnswers.txt");
                break;
            }
            case "success": {
                console.log(`\x1b[1;32mSuccessfully answered with ${message.latestAnswer}!\x1b[0m Correct answer streak:
    ${message.correctAnswers.join(" -> ")}
`);

                knownCorrectAnswers = message.correctAnswers;
                fs.writeFileSync("correctAnswers.txt", knownCorrectAnswers.join("\n"));
                console.log("Correct answers saved to correctAnswers.txt");
                break;
            }
            case "nextAnswer": {
                const answerIndex = knownCorrectAnswers.indexOf(message.currentGuess);
                if(answerIndex !== -1 && answerIndex !== 0) {
                    console.log(`We already know the answer to ${message.currentGuess}.`);
                    const nextAnswer = knownCorrectAnswers[knownCorrectAnswers.indexOf(message.currentGuess) - 1];
                    ws.send(nextAnswer);
                    break;
                }

                const prompt = getPrompt(message.previousGuesses, message.currentGuess);
                console.log(`Prompt: ${prompt}`);
    
                let output;
                while(output === undefined || message.previousGuesses.includes(output) || output.length > MAX_LENGTH) {
                    output = execSync(`ollama run llama3.1 '${prompt.replace("'", '')}'`).toString().trim();
                    if(message.previousGuesses.includes(output)) {
                        console.log(`Generated answer ${output} is a duplicate.`);
                    }
                }

                console.log(`Answering with ${output}.`);

                ws.send(output);
                break;
            }
        }
    });
});

console.log('WebSocket server started on ws://localhost:8080');