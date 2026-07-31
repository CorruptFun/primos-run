# The way in, and the form

## Where the button goes

The default placement — Settings, About, a footer link — is wrong, and it is
wrong for a reason worth understanding rather than just avoiding.

Put it **where the user already is when the thing goes wrong.** A help screen. A
pause menu. The end of a failed flow. The empty state that did not have what
they came for. *I don't understand this* and *this is broken* are one tap apart,
and Settings is a screen you visit on purpose — nobody is in that frame of mind
thirty seconds after something failed them.

In the shipped implementation it sits on the HOW TO PLAY sheet, opened over pause
or over game-over, and **no game state is touched at any point**. That last part
is load-bearing: a bug report must never cost the run that produced it, and the
reports worth having are exactly the ones written mid-failure.

## Give it a face

```html
<button class="corrupt-cta hidden" id="btn-feedback-open" type="button">
  <canvas class="corrupt-face" id="corrupt-face" width="72" height="72" aria-hidden="true"></canvas>
  <span class="corrupt-cta-text">
    <b>TELL CORRUPT</b>
    <span>Found a glitch? Want something in the game? He reads these.</span>
  </span>
</button>
```

A mascot, the founder's photo, whatever the product has. A "Feedback" link reads
as a form; a face reads as a person, and people write more to people.

**The face alone is not enough.** A bare portrait gets ignored — nobody taps a
picture to find out what it does. The face is the draw and the line beside it is
the instruction, and the whole row is one target rather than a picture with a
caption.

If the image loads asynchronously, paint it when it lands and leave the button
tappable meanwhile — the text carries it on its own.

## Voice

If the product has one, the box speaks in it. A support-desk register ("We value
your feedback!") is the fastest way to convince someone that nobody is on the
other end, and it is especially jarring in a product with any personality at all.

Two rules that survive any voice:

- **Say what you actually do.** "He reads these" is true and checkable. "Our team
  will review your submission" is neither.
- **Never promise a reply you will not send.** The optional contact field is
  labelled *if you want an answer* — an offer, not a commitment.

## The form

```
  [ face ]
  TELL CORRUPT
  one line of context, in the product's voice

  [ GLITCH ] [ IDEA ] [ OTHER ]        ← three chips, one selected

  ┌──────────────────────────────────┐
  │  placeholder: a WORKED EXAMPLE   │
  └──────────────────────────────────┘
                          140 left    ← only near the cap

  IF YOU WANT AN ANSWER
  [ email or @handle — optional      ]

  [           SEND IT                ]
  status line
  what is attached, in small print

  [           BACK                   ]
```

**The placeholder is a worked example, not an invitation.** "Tell us what you
think" gets you "good game". Naming the specifics — *What happened? Which lane,
which phone, what you were doing…* — gets you something fixable. This single
string does more for report quality than anything else on the screen.

**The counter appears only near the cap.** A 1000-character budget displayed
against an empty box reads as a demand for an essay, and the box wants one
sentence.

**Refusals clear when they start typing.** "Write something first." must not
still be on screen while they are writing something. A *success* message is a
fact and stays until the next send replaces it.

**Disable the button while sending, and restore it on both outcomes.** The send
resolves either way — there is no path where the label stays "SENDING…".

## The privacy line, in plain words

```
Your message, which build you are on, and an anonymous device ID go with it.
Nothing else — not your email, unless you type it above.
```

Say what is attached. It costs one line, it is the difference between a form
people trust and one they hesitate over, and it forces you to keep the context
bag to things you are willing to name.

## The dormant gate

```js
if (isFeedbackConfigured()) {
  document.getElementById('btn-feedback-open').classList.remove('hidden');
}
```

Hidden by default; the app unhides it only on a build that can deliver. A form
that silently goes nowhere spends the user's goodwill and their actual bug report
at the same time.

## Analytics on the box itself

Track *opened* and *sent*, and log the message's **length**, never its text:

```js
track(EVENTS.FEEDBACK_SEND, { kind, length: sanitizeMessage(message).length });
```

Together they answer what the inbox cannot — how many people opened it and then
did not write. A box nobody finds and a box everybody abandons need opposite
fixes and look identical from the pile of messages.

## Layout warning, from the shipped one

Adding this row to an existing sheet **makes it taller**, and the sheet you chose
is often already the tallest thing in the product — help screens are dense by
nature. Measure the small case (320×568 is the honest floor) in every language
before shipping: the primary button being pushed below the fold is the regression
this creates, and a dismiss button you have to scroll to find is one nobody
finds.

When something has to give, give up decoration before content. In the shipped
one, dropping a purely ornamental wordmark on short screens bought back 50px and
landed both languages inside the viewport — it was the cheapest thing on the
sheet and the only one carrying no information.
