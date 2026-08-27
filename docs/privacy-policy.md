# Privacy Policy

## Overview

EvidenceShot does not sell or share personal data with external servers, and never transmits your captures or page content anywhere.

All capture processing is performed locally inside the user's browser for the purpose of capturing the currently active tab and saving the resulting image to the user's local download destination.

The only outbound transmission happens when you submit the contact form yourself (see "Contact form").

## Permissions Used

### activeTab

Used to capture the currently active tab when the user explicitly starts a capture from the popup.

### storage

Used to save local extension settings such as image format, timestamp options, timestamp size, capture mode, and footer text\.

### scripting

Used to inject the capture control script into the current tab only when a capture is started.

### offscreen

Used to compose captured slices, apply timestamps, and prepare the final image without disturbing the visible page.

### downloads

Used to save the generated screenshot file through Chrome's download system.

### clipboardWrite

Used to copy the generated screenshot image to the clipboard when the user enables that option.

## Keyboard Shortcut

A `commands` entry registers `Ctrl+Shift+Y` (macOS: `Command+Shift+Y`) so the user can capture the current tab from the keyboard. Shortcut captures are user-initiated, run only within the `activeTab` grant, and never transmit data externally.

### host_permissions (support.kagayoi.com)

Used to verify the contact email, submit inquiries, and receive the submission result. No request is made unless you submit the form.

## Data Handling

- Screenshot data is processed locally within the extension runtime
- Settings are stored locally using Chrome extension storage
- No screenshot content is uploaded to any remote service
- Clipboard copy runs locally only, and the extension does not read clipboard contents
- No analytics, tracking, or advertising SDKs are included

## Contact form

Only when you press "Contact support" in the settings popup and submit the form does the extension send the following to Kagayoi Support (`https://support.kagayoi.com`). No such request happens unless you press the button.

- The email address, optional name, inquiry category, subject, and message you entered
- Product ID, extension version, and locale

On first use, the six-digit code delivered by email is sent to Kagayoi Support to verify you. After verification, Kagayoi Support stores the inquiry and replies so that you and support staff can access them. Your captures, the content of pages you browse, and your capture settings are never sent.

## Contact

If the privacy policy needs to be updated for store submission or compliance wording, update this document together with the manifest and product documentation so the behavior description remains consistent.
