-- Framework examples are prompts for caller awareness, not transcript frequency claims.
insert into public.call_stages (stage_number, name, purpose, talk_track, response_patterns, outcome_options)
values
    (1, 'Opening', 'Reach the right person and introduce yourself clearly.', 'Ask for the person by name, then introduce yourself in one calm sentence.',
     '["A gatekeeper asks what the call is about", "The prospect is busy", "The contact is incorrect or outdated"]'::jsonb,
     '["Reached the prospect", "Gatekeeper answered", "Wrong contact", "Prospect unavailable", "Other"]'::jsonb),
    (2, 'Purpose', 'Explain why you are calling in one or two concise sentences.', 'Connect the reason for your call to a relevant business topic. Keep it brief and factual.',
     '["Asks who is calling or what the call concerns", "Asks how you got their contact", "Asks about cost, intent, or what happens next"]'::jsonb,
     '["Purpose understood", "Asked what the company does", "Asked how contact was obtained", "Identified this as a sales call", "Other"]'::jsonb),
    (3, 'Permission', 'Find out whether the prospect is willing to talk now.', 'Ask directly whether now is a good time. Treat anything other than a clear yes as uncertain.',
     '["Asks to speak at a different time", "Requests email or WhatsApp before deciding whether to continue", "The answer is vague or does not grant clear permission"]'::jsonb,
     '["Agreed to continue", "Requested callback", "Requested written information", "Declined to continue", "Other"]'::jsonb),
    (4, 'Their Business', 'Understand the prospect''s business before you discuss a solution.', 'Ask one open question about how the relevant part of their business works today.',
     '["Short answers", "The prospect corrects an assumption", "The prospect asks you to explain your offer first"]'::jsonb,
     '["Shared business context", "Corrected an assumption", "Asked for the pitch first", "Limited response", "Other"]'::jsonb),
    (5, 'Their Need, in Their Words', 'Understand the prospect''s goal or problem and keep their words intact.', 'Ask what they would most like to improve, then give them room to explain without interrupting.',
     '["A goal involving products, markets, customers, or growth", "A constraint involving people or capacity", "The prospect describes stable operations or no immediate need", "The prospect asks what you can offer before sharing more"]'::jsonb,
     '["Identified a goal", "Described a problem", "No immediate need", "Asked what we can offer", "Other"]'::jsonb),
    (6, 'Objection', 'Understand the reason behind resistance without arguing.', 'Acknowledge what you heard, then ask one respectful question if they are open to explaining.',
     '["An existing internal team or outside provider", "Authority sits elsewhere or the contact is not the right person", "Questions about intent, price, or information handling", "A clear refusal or lack of need"]'::jsonb,
     '["Existing provider or team", "Not the right person", "Asked for written information", "Not interested", "Other"]'::jsonb),
    (7, 'Next Step', 'Agree on one concrete action, time, or channel—or record that none was agreed.', 'If there is interest, suggest a small next step and confirm the details in the prospect''s words.',
     '["An explicit callback or meeting is agreed", "Information is requested without a clear commitment", "A referral or alternative contact is offered"]'::jsonb,
     '["Meeting agreed", "Callback agreed", "Information delivery agreed", "Referral provided", "No next step agreed", "Other"]'::jsonb),
    (8, 'Close', 'End clearly and make sure the outcome and next step are recorded accurately.', 'Summarize only what was agreed, confirm the channel or timing, and thank them for the conversation.',
     '["The call ends abruptly", "A polite ending without further interest", "The recorded outcome differs from what the prospect said"]'::jsonb,
     '["Meeting booked", "Callback arranged", "Follow-up information agreed", "Not interested", "Conversation ended without a next step", "Other"]'::jsonb)
on conflict (stage_number) do update set
    name = excluded.name,
    purpose = excluded.purpose,
    talk_track = excluded.talk_track,
    response_patterns = excluded.response_patterns,
    outcome_options = excluded.outcome_options,
    updated_at = now();
