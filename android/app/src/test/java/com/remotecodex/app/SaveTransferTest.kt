package com.remotecodex.app

import java.io.OutputStream
import java.nio.file.Files
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test

class SaveTransferTest {
    @Test fun streamsThroughWebLimitAndCleansUp() {
        val directory = Files.createTempDirectory("export-test").toFile()
        try {
            val transfer = SaveTransfer(directory)
            val chunk = ByteArray(SaveTransfer.CHUNK_BYTES) { 123 }
            transfer.start("../folder/export.bin", SaveTransfer.MAX_BYTES)
            var left = SaveTransfer.MAX_BYTES
            while (left > 0) {
                val bytes = chunk.copyOf(minOf(left, chunk.size.toLong()).toInt())
                transfer.append(Base64.getEncoder().encodeToString(bytes))
                left -= bytes.size
            }
            assertEquals("export.bin", transfer.finish())
            var copied = 0L
            transfer.copyTo(object : OutputStream() {
                override fun write(value: Int) { assertEquals(123, value); copied++ }
                override fun write(bytes: ByteArray, offset: Int, length: Int) {
                    assertTrue((offset until offset + length).all { bytes[it] == 123.toByte() })
                    copied += length
                }
            })
            assertEquals(SaveTransfer.MAX_BYTES, copied)
            transfer.clear()
            assertTrue(directory.resolve("exports").listFiles()!!.isEmpty())
        } finally { directory.deleteRecursively() }
    }

    @Test fun rejectsBadLengthsAndIncompleteTransfers() {
        val directory = Files.createTempDirectory("export-test").toFile()
        try {
            val transfer = SaveTransfer(directory)
            assertThrows(IllegalArgumentException::class.java) { transfer.start("large", SaveTransfer.MAX_BYTES + 1) }
            transfer.start("one", 1)
            assertThrows(IllegalArgumentException::class.java) { transfer.finish() }
            assertThrows(IllegalArgumentException::class.java) { transfer.append("a".repeat(65540)) }
            assertThrows(IllegalArgumentException::class.java) { transfer.append("???") }
            assertThrows(IllegalArgumentException::class.java) { transfer.append("YWI=") }
            transfer.clear()
            transfer.start("empty", 0)
            assertEquals("empty", transfer.finish())
            transfer.clear()
        } finally { directory.deleteRecursively() }
    }
}
