package com.example.tautracker.domain.usecase

import com.example.tautracker.data.remote.MoodleCourseModule
import com.example.tautracker.data.remote.MoodleCourseSection
import com.example.tautracker.data.remote.MoodleModuleContent
import org.junit.Assert.assertEquals
import org.junit.Test

class ExtractZoomLinksUseCaseTest {

    private val useCase = ExtractZoomLinksUseCase()

    @Test
    fun `extract zoom links from fileurl`() {
        val sections = listOf(
            MoodleCourseSection(
                id = 1L,
                name = "Section 1",
                modules = listOf(
                    MoodleCourseModule(
                        id = 10L,
                        name = "Lecture 1",
                        contents = listOf(
                            MoodleModuleContent(
                                type = "url",
                                filename = "zoom link",
                                fileurl = "https://tau-ac-il.zoom.us/j/123456789"
                            )
                        )
                    )
                )
            )
        )

        val result = useCase.execute(sections)
        assertEquals(1, result.size)
        assertEquals("Lecture 1", result[0].name)
        assertEquals("https://tau-ac-il.zoom.us/j/123456789", result[0].url)
    }

    @Test
    fun `extract zoom links from regex`() {
        val sections = listOf(
            MoodleCourseSection(
                id = 1L,
                name = "Section 1",
                modules = listOf(
                    MoodleCourseModule(
                        id = 10L,
                        name = "Lecture 2",
                        contents = listOf(
                            MoodleModuleContent(
                                type = "file",
                                filename = "document.pdf",
                                fileurl = "Some text with a link https://tau-ac-il.zoom.us/j/987654321 inside"
                            )
                        )
                    )
                )
            )
        )

        val result = useCase.execute(sections)
        assertEquals(1, result.size)
        assertEquals("https://tau-ac-il.zoom.us/j/987654321", result[0].url)
    }
}
