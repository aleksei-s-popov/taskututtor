# Privacy notice: working notes

The published version is `site/public/privacy.html`. Keep the two in step when what the service
collects changes.

This is a factual starting point for the production service's privacy notice, written from what
the code does. It is **not legal advice and not ready to publish**: add who operates the service
and how to reach you, check it against the law that applies to you (in the EU, the GDPR), and
publish it on the landing site before letting readers in.

## What the service stores

- **Account:** your email address and sign-in sessions are handled by Clerk, our sign-in provider.
- **Your reading:** the stories written for you, your reading level, the words you looked up and
  which words you are treated as knowing, your answers to chapter questions, and your settings.
  Stored on Cloudflare (database and file storage) so that it follows you between devices.
- **Illustrations** generated for your chapters, stored the same way.
- **Backups:** a weekly copy of the database, kept for about three months.

## What is sent to AI providers

To write your chapters, word lists, dictionary entries and illustrations, the service sends
prompts to AI models through OpenRouter. These prompts contain your reading level, your stated
interests, the words you are learning and the story so far. They do not contain your name or
email address.

## Usage data

The service records events about how it is used, with PostHog (hosted in the EU): signing in,
screens opened, chapters requested and finished, your feedback on a chapter, how many words you
looked up, question scores, features used, errors, and the cost and duration of each AI call.
These are linked to your account id, not your email address.

Not recorded: the text of your stories, the words you look up, anything you type, recordings of
your screen, or general click tracking. No analytics cookie or similar identifier is stored on
your device.

## What is not done

No advertising, no selling of data, no sharing beyond the processors named above.

## Still to add before publishing

- Who the controller is, and a contact address.
- The legal basis for each kind of processing.
- How long account data is kept after an account is closed, and how to ask for deletion or a copy.
- The processors' locations and transfer safeguards (Clerk, Cloudflare, OpenRouter and the model
  providers behind it, PostHog).
