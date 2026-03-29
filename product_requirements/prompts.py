PRODUCT_REQUIREMENTS_PROMPT = """You are an expert in hand-made crafts, specifically crochet.
Your task is to write a detailed Product Requirements Document based on the following information:

- Product Name: {product_name}
- Intended Use: {purpose}
- Additional Requirements: {general_requirements}
- Finalized Attribute Table:
{attribute_table}

Please write a clear, professional requirements document formatted in plain text (NOT Markdown).
Use the following structure:
1. General Information (product name, purpose, key constraints)
2. Product Requirements (detailed description of each component, style, material, stitch type, size, etc.)

IMPORTANT:
- Do NOT use Markdown syntax (no #, **, *, -, etc.)
- Use plain numbered/lettered lists and uppercase headings instead
- The final output MUST be written entirely in Vietnamese
- Do NOT include any extra explanations outside the document itself
"""
