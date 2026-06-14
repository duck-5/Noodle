package com.example.tautracker.domain.usecase

import com.example.tautracker.data.remote.MoodleCourseSection

data class ZoomLink(val name: String, val url: String)

class ExtractZoomLinksUseCase {

    fun execute(sections: List<MoodleCourseSection>): List<ZoomLink> {
        val zoomLinks = mutableListOf<ZoomLink>()
        val zoomRegex = "(https?://[a-zA-Z0-9.-]*zoom\\.us/[a-zA-Z0-9./?=&_%+-]+)".toRegex()

        for (section in sections) {
            for (module in section.modules) {
                // Extract from module url if present
                module.url?.let { url ->
                    zoomRegex.findAll(url).forEach { match ->
                        zoomLinks.add(ZoomLink(module.name, match.value))
                    }
                }

                // Extract from module content urls
                for (content in module.contents) {
                    zoomRegex.findAll(content.fileurl).forEach { match ->
                        zoomLinks.add(ZoomLink(module.name, match.value))
                    }
                }
            }
        }
        
        return zoomLinks.distinctBy { it.url }
    }
}
