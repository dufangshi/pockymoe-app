package com.remotecodex.app

import java.io.File
import java.io.OutputStream
import java.util.Base64

/** Single export, used serially on Dispatchers.IO; no file-sized native allocation. */
internal class SaveTransfer(cacheDir: File) {
    private val directory = File(cacheDir, "exports").apply {
        mkdirs()
        // A killed process cannot run cleanup. No export survives a new activity.
        listFiles()?.forEach { it.delete() }
    }
    private var file: File? = null
    private var expected = 0L
    private var written = 0L
    private var name = ""

    fun start(filename: String, size: Long) {
        require(file == null)
        require(size in 0..MAX_BYTES)
        name = filename.substringAfterLast('/').substringAfterLast('\\').take(255).ifBlank { "export" }
        expected = size
        written = 0
        file = File.createTempFile("save-", ".part", directory)
    }

    fun append(encoded: String) {
        val target = checkNotNull(file)
        require(encoded.length <= CHUNK_BYTES / 3 * 4)
        val bytes = Base64.getDecoder().decode(encoded)
        require(bytes.size <= CHUNK_BYTES && written + bytes.size <= expected)
        target.appendBytes(bytes)
        written += bytes.size
    }

    fun finish(): String {
        checkNotNull(file)
        require(written == expected)
        return name
    }

    fun copyTo(output: OutputStream) {
        require(written == expected)
        checkNotNull(file).inputStream().use { it.copyTo(output, 32 * 1024) }
    }

    fun clear() {
        file?.delete()
        file = null
        expected = 0
        written = 0
    }

    companion object {
        const val MAX_BYTES = 64L * 1024 * 1024
        const val CHUNK_BYTES = 48 * 1024
    }
}
