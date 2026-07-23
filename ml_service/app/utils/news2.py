"""
NEWS2 (National Early Warning Score 2)

Reference:
Royal College of Physicians - NEWS2

This module computes a NEWS2 score from patient vitals.
"""

def news2_score(hr, rr, spo2, sbp, temp, consciousness="alert"):

    score = 0

    # -------------------------
    # Heart Rate
    # -------------------------
    if hr <= 40 or hr >= 131:
        score += 3
    elif 41 <= hr <= 50:
        score += 1
    elif 91 <= hr <= 110:
        score += 1
    elif 111 <= hr <= 130:
        score += 2

    # -------------------------
    # Respiratory Rate
    # -------------------------
    if rr <= 8:
        score += 3
    elif 9 <= rr <= 11:
        score += 1
    elif 21 <= rr <= 24:
        score += 2
    elif rr >= 25:
        score += 3

    # -------------------------
    # Oxygen Saturation
    # -------------------------
    if spo2 <= 91:
        score += 3
    elif 92 <= spo2 <= 93:
        score += 2
    elif 94 <= spo2 <= 95:
        score += 1

    # -------------------------
    # Systolic Blood Pressure
    # -------------------------
    if sbp <= 90:
        score += 3
    elif 91 <= sbp <= 100:
        score += 2
    elif 101 <= sbp <= 110:
        score += 1
    elif sbp >= 220:
        score += 3

    # -------------------------
    # Temperature
    # -------------------------
    if temp <= 35:
        score += 3
    elif 35.1 <= temp <= 36:
        score += 1
    elif 38.1 <= temp <= 39:
        score += 1
    elif temp >= 39.1:
        score += 2

    # -------------------------
    # Consciousness
    # -------------------------
    if consciousness.lower() != "alert":
        score += 3

    return score


def risk_from_news(score):

    if score >= 13:
        return "Critical"

    elif score >= 7:
        return "Urgent"

    elif score >= 3:
        return "Moderate"

    return "Non-Urgent"