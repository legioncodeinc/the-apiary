# Nectar for the AI-Augmented Developer

*The Apiary by Legion Code, in collaboration with Activeloop.*

## Why does your agent open the wrong file when you ask a simple question?

Ask where you handle logins and your agent hunts for login.ts, misses the real file buried three folders deep, and hands you a confident answer about the wrong code. Nectar gives every file a plain-language description of what it actually does, so your agent finds code by meaning and stops guessing from names.

### Why can't my agent find code that isn't named after what it does?

Because it searches names and keywords, and real codebases hide login logic in a file called session-refresh.ts. Nectar reads each file and writes down what it does, so a search for logins lands on the right one even when the name never says so.

### Do I have to change how I work?

No. Nectar runs quietly and keeps its descriptions current as files change, and the better answers surface right inside your assistant through Honeycomb's shared memory. You ask the same questions and get the right files back.

### How does it match meaning instead of keywords?

The descriptions live on Deeplake, which searches by meaning, so 'anything about logins' finds the right file even when you would never have guessed its name or where it sits. It is the book index that actually read every chapter.

### Will it keep up as the code moves?

Yes. Nectar re-reads files as they change, so a renamed or relocated file still gets found by what it does. Poorly named, buried, or freshly moved, your agent still lands on it.
