const previousGuessSelector = "body > div.font-comic.h-dvh.mx-4.sm\\:mx-32.md\\:mx-48.lg\\:mx-72.xl\\:mx-96 > div.flex.flex-col.pb-48.w-full.items-center.top-\\[35\\%\\].sm\\:top-1\\/4.justify-start.relative > div:nth-child(6) > p";
const currentGuessSelector = "body > div.font-comic.h-dvh.mx-4.sm\\:mx-32.md\\:mx-48.lg\\:mx-72.xl\\:mx-96 > div.flex.flex-col.pb-48.w-full.items-center.top-\\[35\\%\\].sm\\:top-1\\/4.justify-start.relative > p.text-2xl.text-center";

function getStreakElement() {
    return Array.from(document.querySelectorAll("p")).filter(e => (e.innerText.includes("😵") || e.innerText.includes("🤜")) && e.innerText.includes("rock"))[0];
}

function getCorrectAnswerList() {
    return getStreakElement().innerText.split(" 🤜 ").map(e => {
        if(e.includes(" 😵 ")) {
            return e.split(" 😵 ")[1];
        } else {
            return e;
        }
    });
}

var script = document.createElement('script');
script.type = 'text/javascript';
script.src = 'https://unpkg.com/react-trigger-change/dist/react-trigger-change.js';
document.head.appendChild(script);

(async () => {
    while(window["reactTriggerChange"] === undefined) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    const inputSelector = "input.pl-4";
    const doesNotBeatSelector = "div.relative > p.text-center.text-3xl.sm\\:text-5xl.pb-2.text-red-400";
    const beatsSelector = "p.text-2xl.sm\\:text-4xl.pb-2.text-green-400.text-center";
    const nextSelector = "div.flex-col > button.py-4";
    const goSelector = "div > form > button";
    const playAgainSelector = "div.flex.flex-row.gap-2.pt-4.pb-2 > button:nth-child(1)";

    const ws = new WebSocket("ws://localhost:8080");

    function requestNextAnswer() {
        const currentGuess = document.querySelector(currentGuessSelector).innerText.slice(0, -1);
        const previousGuesses = getCorrectAnswerList();
        ws.send(JSON.stringify({
            type: "nextAnswer",
            currentGuess,
            previousGuesses
        }));
    }

    ws.addEventListener("close", () => {
        alert("Connection to server closed.");
    });

    ws.addEventListener("message", async (event) => {
        const message = event.data;

        const input = document.querySelector(inputSelector);
        input.value = message;
        reactTriggerChange(input);
        
        document.querySelector(goSelector).click();

        while(document.querySelector(doesNotBeatSelector) === null && document.querySelector(beatsSelector) === null) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        if(document.querySelector(doesNotBeatSelector) !== null) {
            ws.send(JSON.stringify({
                type: "failure",
                latestAnswer: message,
                correctAnswers: getCorrectAnswerList()
            }));

            while(document.querySelector(playAgainSelector) === null) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            document.querySelector(playAgainSelector).click(); // This will refresh the tab.
        } else {
            ws.send(JSON.stringify({
                type: "success",
                latestAnswer: message,
                correctAnswers: getCorrectAnswerList()
            }));

            while(document.querySelector(nextSelector) === null) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            document.querySelector(nextSelector).click();

            while(document.querySelector(inputSelector) === null) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            requestNextAnswer();
        }
    });

    ws.addEventListener("open", () => {
        console.log("Starting in 1 second...");
        setTimeout(() => {
            requestNextAnswer();
        }, 1000);
    });

    navigator.wakeLock.request("screen").then(() => {
        console.log("Wake lock acquired");
    }).catch((error) => {
        console.error(`Wake lock request failed: ${error}`);
    });
})();