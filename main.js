import { execSync } from 'child_process';
import fs from "fs";
import puppeteer from "puppeteer-extra";

import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

const MAX_LENGTH = 230; // characters
const DELAY_BETWEEN_ANSWERS = 600; // ms

if(!fs.existsSync("correctAnswers.txt")) {
    fs.writeFileSync("correctAnswers.txt", "");
}
let knownCorrectAnswers = fs.readFileSync("correctAnswers.txt").toString().split("\n");

function getPrompt(previousGuesses, currentGuess) {
    return `Determine an item or concept that would beat "${currentGuess}" \
in an alternative, extreme, version of Rock Paper Scissors where any move can be made. \
Be creative and do not repeat answers. Do not add punctuation to your answer. \
Keep your answers relatively short, simple, and ensure you'll acquire a decisive win! \
DO NOT answer with two concepts similar to each other, and do not answer with a concept that is a subset of another concept. \
While your answer should beat ${currentGuess} in this game, it should not be too similar to it. \
Don't answer with a concept that is too broad or too specific. \

DO NOT repeat these. As an example, "drought" could beat "water", and "rust" could beat "scissors". \
Examples of answers that are too related are "event horizon" beating "black hole". \
Stay away from answers that are so broad they could beat anything, like "God". \
MOVE ANSWERS AWAY FROM CONCEPTS THAT HAVE ALREADY BEEN MOVED THROUGH. \
MAKE ABSOLUTELY SURE TO KEEP YOUR ANSWER SHORT AND SIMPLE. \
Answer with only the item or concept; do not add extra text. \

Previous answers include ${previousGuesses.slice(0, previousGuesses.length - 1).map(e => `"${e}"`).join(", ")}, and "rock"; \

Determine an item or concept that would beat "${currentGuess}" \
in an alternative, extreme, version of Rock Paper Scissors where any move can be made. \
Be creative and do not repeat answers. Do not add punctuation to your answer. \
Keep your answers relatively short, simple, and ensure you'll acquire a decisive win! \
DO NOT answer with two concepts similar to each other, and do not answer with a concept that is a subset of another concept. \
While your answer should beat ${currentGuess} in this game, it should not be too similar to it. \
Don't answer with a concept that is too broad or too specific. \

DO NOT repeat these. As an example, "drought" could beat "water", and "rust" could beat "scissors". \
Examples of answers that are too related are "event horizon" beating "black hole". \
Stay away from answers that are so broad they could beat anything, like "God". \
MOVE ANSWERS AWAY FROM CONCEPTS THAT HAVE ALREADY BEEN MOVED THROUGH. \
MAKE ABSOLUTELY SURE TO KEEP YOUR ANSWER SHORT AND SIMPLE. \
Answer with only the item or concept; do not add extra text. \

What would decisively beat "${currentGuess}" in this game?`;
}


const browser = await puppeteer.connect({
    browserWSEndpoint: "ws://localhost:9222/devtools/browser/a80ab03a-574a-4b8d-bfa2-a189e990239f"
});

async function getNextAnswer(previousGuesses, currentGuess) {
    const answerIndex = knownCorrectAnswers.indexOf(currentGuess);
    if(answerIndex !== -1 && answerIndex !== 0) {
        console.log(`We already know the answer to ${currentGuess}.`);
        const nextAnswer = knownCorrectAnswers[knownCorrectAnswers.indexOf(currentGuess) - 1];
        console.log(`Answering with ${nextAnswer}.`);

        return nextAnswer;
    }

    const prompt = getPrompt(previousGuesses, currentGuess);
    console.log(`Prompt: ${prompt}`);

    let output;
    while(output === undefined || previousGuesses.includes(output) || output.length > MAX_LENGTH) {
        output = execSync(`ollama run llama3.1 '${prompt.replace("'", '')}'`).toString().trim();
        if(previousGuesses.includes(output)) {
            console.log(`Generated answer ${output} is a duplicate.`);
        }
    }

    console.log(`Answering with ${output}.`);

    return output;
}

async function run() {
    const page = await browser.newPage();
    
    page.on('load', async () => {
        if(await page.url() !== "https://www.whatbeatsrock.com/") {
            return;
        }
        console.log(await page.url());

        const previousGuessSelector = "div.justify-start.relative > div:nth-child(6) > p";
        const currentGuessSelector = "div.justify-start.relative > p.text-2xl.text-center";
        const inputSelector = "input.pl-4";
        const doesNotBeatSelector = "div.relative > p.text-center.text-3xl.sm\\:text-5xl.pb-2.text-red-400";
        const beatsSelector = "p.text-2xl.sm\\:text-4xl.pb-2.text-green-400.text-center";
        const nextSelector = "div.flex-col > button.py-4";
        const goSelector = "div > form > button";
        const playAgainSelector = "div.flex.flex-row.gap-2.pt-4.pb-2 > button:nth-child(1)";

        async function getCorrectAnswerList() {
            return await page.evaluate(`
            (() => {
                const element = Array.from(document.querySelectorAll("p")).filter(e => (e.innerText.includes("😵") || e.innerText.includes("🤜")) && e.innerText.includes("rock"))[0];
                return element ? element.innerText.split(" 🤜 ").map(e => {
                    if(e.includes(" 😵 ")) {
                        return e.split(" 😵 ")[1];
                    } else {
                        return e;
                    }
                }) : ["rock"];
            })();`);
        }
        async function getCurrentGuess() {
            return await page.evaluate(`document.querySelector("${currentGuessSelector}").innerText.slice(0, -1)`);
        }

        async function respond() {
            const previousAnswers = await getCorrectAnswerList();
            if(previousAnswers.length === 0) {
                console.log("No previous answers found. Only using 'rock'.");
            }

            const nextAnswer = await getNextAnswer(
                previousAnswers,
                await getCurrentGuess()
            );
            await page.locator(inputSelector).fill(nextAnswer);
            
            await page.locator(goSelector).click();
            await Promise.race([
                page.waitForSelector(doesNotBeatSelector),
                page.waitForSelector(beatsSelector)
            ]);

            if(await page.$(doesNotBeatSelector) !== null) { // Failure
                const answers = await getCorrectAnswerList();
                console.log(`\x1b[1;31mIncorrectly answered with ${nextAnswer}.\x1b[0m Correct answer streak: \n    ${answers.join(" -> ")}`);

                const newCorrectAnswers = await getCorrectAnswerList();
                if(newCorrectAnswers.length > knownCorrectAnswers.length) {
                    console.log("New correct answers found!");

                    knownCorrectAnswers = newCorrectAnswers;
                    fs.writeFileSync("correctAnswers.txt", knownCorrectAnswers.join("\n"));
                    console.log("Correct answers saved to correctAnswers.txt");
                }

                // await page.waitForSelector(playAgainSelector);
                // await page.locator(playAgainSelector).click(); // The page will reload, which will run the load event and replay the game.
            } else { // Success
                const answers = await getCorrectAnswerList();
                console.log(`\x1b[1;32mSuccessfully answered with ${nextAnswer}!\x1b[0m Correct answer streak: \n    ${answers.join(" -> ")}`);

                const newCorrectAnswers = await getCorrectAnswerList();
                if(newCorrectAnswers.length > knownCorrectAnswers.length) {
                    console.log("New correct answers found!");

                    knownCorrectAnswers = newCorrectAnswers;
                    fs.writeFileSync("correctAnswers.txt", knownCorrectAnswers.join("\n"));
                    console.log("Correct answers saved to correctAnswers.txt");
                }

                await page.waitForSelector(nextSelector);
                await page.locator(nextSelector).click();

                await page.waitForSelector(inputSelector);
                setTimeout(respond, DELAY_BETWEEN_ANSWERS);
            }
        }

        respond();
    });

    await page.goto('https://whatbeatsrock.com/');
    await page.setViewport({ width: 952, height: 958 });
}

run();