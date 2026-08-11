# Retrieval eval set

One case per line, pipe-separated:

    market | question | expected source substring

The case passes when at least one of the top-k retrieved chunks comes from a
document whose `source_path` contains the expected substring. Run with:

    npm run eval
    npm run eval -- --k 3        stricter
    RERANK=1 npm run eval        compare with reranking on

Lines starting with `#` are ignored. **Add real questions your team actually
asks** — this starter set covers the obvious ground, but the cases that matter
are the ones someone got wrong in a live conversation.

# --- Per-market guideline lookups -------------------------------------------
uae | how many working days is the standard shipping SLA | uae_guidelines
ksa | how many working days is the standard shipping SLA | ksa_guidelines
za  | what is the restocking fee for a change of mind return | za_guidelines
ph  | what number do customers call for support | ph_guidelines
hk  | what are the support contact hours on the website | hk_guidelines
th  | how do I handle a request for an invoice or receipt | th_guidelines
uae | customer wants to cancel their order, is there a fee | uae_guidelines
ksa | how do I check whether a device is still under warranty | ksa_guidelines
uae | customer is asking for a promo code or discount | uae_guidelines
za  | what are the device cosmetic grades | za_guidelines
ph  | the customer's installment payment was rejected | ph_guidelines
uae | device arrived with a cracked screen within 24 hours | uae_guidelines
hk  | order number has a foreign prefix from another country | hk_guidelines
th  | customer wants to update their delivery address | th_guidelines
uae | when do I transfer the conversation to a human agent | uae_guidelines
za  | customer asking about cashback or store credit balance | za_guidelines
uae | customer wants to sell or exchange their old device | uae_guidelines

# --- Master template (internal policy questions) ---------------------------
master | what does guideline G12 cover | guidelines.md
master | which guidelines trigger a human transfer | guidelines.md

# --- Global training material (the PDFs) -----------------------------------
global | what is the end to end claim lifecycle | Claims Process
global | how should the inbound team answer a call | Inbound
global | how do we handle high courier charges for remote areas | Operations
global | how does a buyback request move from creation to completion | Orders
global | how do we handle tickets coming from social media | Tickets
