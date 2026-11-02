package com.seebuyget.driver.car

/** What came back from the server: an answer with its status, or none at all (no signal, a timeout). */
sealed interface HttpOutcome {
    data class Answer(val status: Int, val body: String?) : HttpOutcome
    data object NoAnswer : HttpOutcome
}

/** Why something the car asked for did not happen, said by what the driver can do about it (2026-11-02). */
sealed interface Refusal {
    /** The car key opens nothing any more (turned off, the phone forgotten, the PIN reset): forgotten here too. */
    data object KeyOff : Refusal

    /** No answer: no signal, or none in time. */
    data object NoSignal : Refusal

    /** Asked too often. */
    data object TooMany : Refusal

    /** The car heard nothing to send. */
    data object NothingHeard : Refusal

    /** The server failed, or answered with something that is not its answer. */
    data object ServerTrouble : Refusal

    /** Refused, without saying why. */
    data object Refused : Refusal

    /** Refused, in the server's own words — "This conversation is closed." — which the car reads aloud. */
    data class Said(val detail: String) : Refusal
}

/** A spoken reply, after it was tried. */
sealed interface ReplyOutcome {
    data class Sent(val text: String) : ReplyOutcome
    data class NotSent(val refusal: Refusal) : ReplyOutcome
}

/**
 * 2026-11-02 — READING THE SERVER'S ANSWER. A reply is refused the way a typed one is (closed, blocked, too long), and
 * the refusal is said back to the driver in the server's own words; what the car cannot fix is said plainly. A
 * refusal's words are the server's `detail` (RFC 9457 problem+json, foundation/http/problem.filter.ts), cut short and
 * cleaned, since the car reads them aloud.
 */
object CarReplies {
    private const val MAX_DETAIL = 200

    /** The words the car heard, ready to send; null when it heard nothing. */
    fun prepare(heard: CharSequence?): String? = heard?.toString()?.trim()?.takeIf { it.isNotEmpty() }

    /** Null when the server took it (2xx); otherwise why not. */
    fun refusal(outcome: HttpOutcome): Refusal? = when (outcome) {
        HttpOutcome.NoAnswer -> Refusal.NoSignal
        is HttpOutcome.Answer -> when (outcome.status) {
            in 200..299 -> null
            401 -> Refusal.KeyOff
            429 -> Refusal.TooMany
            in 400..499 -> detail(outcome.body)?.let { Refusal.Said(it) } ?: Refusal.Refused
            else -> Refusal.ServerTrouble
        }
    }

    fun outcome(text: String, answer: HttpOutcome): ReplyOutcome =
        refusal(answer)?.let { ReplyOutcome.NotSent(it) } ?: ReplyOutcome.Sent(text)

    /** The server's sentence from a refusal, fit to be read aloud; null when it gave none. */
    fun detail(body: String?): String? {
        val problem = Json.read(body) ?: return null
        val said = Json.text(problem, CarContract.Fields.DETAIL) ?: Json.text(problem, CarContract.Fields.MESSAGE) ?: return null
        val clean = said.map { if (it.isISOControl() || it.isWhitespace()) ' ' else it }
            .joinToString("")
            .replace(Regex(" {2,}"), " ")
            .trim()
        if (clean.isEmpty()) return null
        return if (clean.length <= MAX_DETAIL) clean else clean.substring(0, MAX_DETAIL - 1).trimEnd() + "…"
    }
}
